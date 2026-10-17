import { buildCheckoutConfig, type CheckoutConfig } from '@/lib/engine/checkout-config'
import { CHECKOUT_BLOCK_MESSAGES, checkoutBlockReason } from '@/lib/engine/checkout-policy'
import { reviewCodeForReason, reviewMessage } from '@/lib/payment-review-messages'
import type { CheckoutOrder, ConfirmResult, OrderStore } from './order-store'
import type { GatewaySession, StripeGateway } from './stripe-gateway'

export interface CheckoutDeps {
  store: OrderStore
  stripe: StripeGateway
  now: () => Date
  wait: (ms: number) => Promise<void>
  baseUrl: string
  newClaimId: () => string
}

export type PayResult =
  | { kind: 'redirect'; url: string }
  | { kind: 'paid'; confirmationNumber: string | null }
  | { kind: 'start_again'; message: string }
  | { kind: 'blocked'; message: string }
  | { kind: 'try_again'; message: string }
  | { kind: 'review'; message: string; supportRef: string | null }
  | { kind: 'error'; message: string }

export type CancelResult =
  | { kind: 'cancelled' }
  | { kind: 'paid'; confirmationNumber: string | null }
  | { kind: 'try_again'; message: string }
  | { kind: 'review'; message: string; supportRef: string | null }
  | { kind: 'error'; message: string }

export const CHECKOUT_MESSAGES = {
  notFound: 'Registration not found.',
  expired: 'This registration has expired. Please start a new one.',
  cancelled: 'This registration was cancelled. Please start a new one.',
  starting: 'Payment is taking a moment to start. Please try again.',
  couldNotStart: "Payment couldn't start for this feis. Please contact the organiser.",
  cancelLater: "We can't cancel this yet because a payment may still be starting. Please try again in a few minutes.",
  noCheckoutPage: "Stripe didn't return a payment page. Please try again."
} as const

/** Pay sends no create request once a claim is this old */
export const CREATE_DEADLINE_MS = 5 * 60_000
/** By this age every create request for a claim has finished, so a session that can't be found was never made */
export const CREATE_SETTLED_AFTER_MS = 10 * 60_000
/** Look this far before the claim time too, in case the clocks differ */
const CLAIM_LOOKUP_BEFORE_MS = 60_000
/** Calls per attempt to create a session: the first try plus identical replays */
const CREATE_TRIES = 4

type ClaimedOrder = CheckoutOrder & {
  checkout_claim_id: string
  checkout_config: CheckoutConfig
  checkout_claimed_at: string
}

function isClaimed(order: CheckoutOrder): order is ClaimedOrder {
  return Boolean(order.checkout_claim_id && order.checkout_config && order.checkout_claimed_at)
}

function claimAge(deps: CheckoutDeps, order: ClaimedOrder): number {
  return deps.now().getTime() - new Date(order.checkout_claimed_at).getTime()
}

function redirectTo(session: GatewaySession): PayResult {
  return session.url
    ? { kind: 'redirect', url: session.url }
    : { kind: 'error', message: CHECKOUT_MESSAGES.noCheckoutPage }
}

// ─── Pay ───

export async function pay(
  deps: CheckoutDeps,
  input: { registrationId: string; householdId: string }
): Promise<PayResult> {
  const order = await deps.store.getOrderForCheckout(input.registrationId, input.householdId)
  if (!order) return { kind: 'error', message: CHECKOUT_MESSAGES.notFound }
  return payOrder(deps, order)
}

async function payOrder(deps: CheckoutDeps, order: CheckoutOrder): Promise<PayResult> {
  switch (order.status) {
    case 'paid':
      return { kind: 'paid', confirmationNumber: order.confirmation_number }
    case 'expired':
      return { kind: 'start_again', message: CHECKOUT_MESSAGES.expired }
    case 'cancelled':
      return { kind: 'start_again', message: CHECKOUT_MESSAGES.cancelled }
    case 'draft':
    case 'pending_payment':
      break
  }
  if (isClaimed(order)) return resumeClaim(deps, order)
  if (order.status !== 'draft') return { kind: 'error', message: CHECKOUT_MESSAGES.notFound }

  // A quick check for a clear message; claim_checkout makes the final decision under its lock
  const block = checkoutBlockReason({
    listingStatus: order.listing.status,
    stripeAccountId: order.listing.stripe_account_id,
    competitionIds: order.competition_ids,
    enabledCompetitionIds: order.enabled_competition_ids,
    totalCents: order.total_cents
  })
  if (block) return { kind: 'blocked', message: CHECKOUT_BLOCK_MESSAGES[block] }

  const claimId = deps.newClaimId()
  const config = buildCheckoutConfig({
    registrationId: order.id,
    feisListingId: order.feis_listing_id,
    claimId,
    account: order.listing.stripe_account_id!,
    totalCents: order.total_cents,
    applicationFeeCents: order.application_fee_cents,
    eventFeeCents: order.event_fee_cents,
    snapshot: order.purchase_snapshot,
    baseUrl: deps.baseUrl,
    now: deps.now()
  })
  const claim = await deps.store.claimCheckout({
    registrationId: order.id,
    householdId: order.household_id,
    claimId,
    config
  })
  switch (claim.result) {
    case 'claimed':
      return createAndAttach(deps, {
        ...order,
        checkout_claim_id: claim.claim_id,
        checkout_config: claim.config,
        checkout_claimed_at: claim.claimed_at
      })
    case 'already_claimed':
      return reread(deps, order)
    case 'blocked':
      return { kind: 'blocked', message: CHECKOUT_BLOCK_MESSAGES[claim.reason] }
    case 'not_claimable':
      return claim.hold_expired
        ? { kind: 'start_again', message: CHECKOUT_MESSAGES.expired }
        : reread(deps, order)
    case 'not_found':
      return { kind: 'error', message: CHECKOUT_MESSAGES.notFound }
  }
}

/** Another request changed the order: answer from its current state */
async function reread(deps: CheckoutDeps, order: CheckoutOrder): Promise<PayResult> {
  const fresh = await deps.store.getOrderForCheckout(order.id, order.household_id)
  if (!fresh) return { kind: 'error', message: CHECKOUT_MESSAGES.notFound }
  if (fresh.status === 'draft' && !isClaimed(fresh)) {
    return { kind: 'start_again', message: CHECKOUT_MESSAGES.expired }
  }
  return payOrder(deps, fresh)
}

/** The order already has its one claim: carry on with it, never replace it. */
async function resumeClaim(deps: CheckoutDeps, order: ClaimedOrder): Promise<PayResult> {
  if (order.status === 'draft' && !order.stripe_checkout_session_id && claimAge(deps, order) < CREATE_DEADLINE_MS) {
    // Another click is making the session, or an earlier Pay stopped: replay the identical request
    return createAndAttach(deps, order)
  }
  const located = await locateClaimSession(deps, order)
  switch (located.kind) {
    case 'found':
      return order.stripe_checkout_session_id
        ? settleForPay(deps, order, located.session)
        : attachOrSettle(deps, order, located.session)
    case 'none':
      return abandonClaim(deps, order, CHECKOUT_MESSAGES.expired)
    case 'unknown':
      return { kind: 'try_again', message: CHECKOUT_MESSAGES.starting }
  }
}

async function createAndAttach(deps: CheckoutDeps, order: ClaimedOrder): Promise<PayResult> {
  let refused = false
  for (let tries = 0; tries < CREATE_TRIES && claimAge(deps, order) < CREATE_DEADLINE_MS; tries++) {
    const outcome = await deps.stripe.createCheckoutSession(order.checkout_config)
    if (outcome.kind === 'created') return attachOrSettle(deps, order, outcome.session)
    if (outcome.failure === 'rejected') {
      console.error(`[CHECKOUT] Stripe refused the checkout for order ${order.id}: ${outcome.message}`)
      refused = true
      break
    }
    // 'retry' or 'in_progress': pause, then replay the identical request
    await deps.wait(500 * (tries + 1))
  }

  // No session in hand. An error, even a refusal, says nothing certain about earlier attempts
  // with this key, so look the session up instead of guessing (spec §6a).
  const located = await locateClaimSession(deps, order)
  if (located.kind === 'found') return attachOrSettle(deps, order, located.session)
  if (located.kind === 'none') {
    return abandonClaim(deps, order, refused ? CHECKOUT_MESSAGES.couldNotStart : CHECKOUT_MESSAGES.expired)
  }
  return refused
    ? { kind: 'error', message: CHECKOUT_MESSAGES.couldNotStart }
    : { kind: 'try_again', message: CHECKOUT_MESSAGES.starting }
}

/** Attaches a session made or found for this claim, or settles it if the order moved on meanwhile. */
async function attachOrSettle(deps: CheckoutDeps, order: ClaimedOrder, session: GatewaySession): Promise<PayResult> {
  const attach = await deps.store.attachCheckoutSession(order.id, order.checkout_claim_id, session.id)
  if (attach.result === 'attached' || attach.result === 'already_attached') {
    if (attach.status === 'pending_payment') {
      return settleForPay(deps, { ...order, status: 'pending_payment', stripe_checkout_session_id: session.id }, session)
    }
    if (attach.status === 'paid') return reread(deps, order)
  }
  // Cancelled, expired or confirmed while the session was being made: settle the session itself
  const settled = await settleSession(deps, order, session, 'close')
  if (settled.kind === 'result') return settled.result
  if (settled.kind === 'unknown') return unknownResult(settled)
  return reread(deps, order)
}

async function settleForPay(deps: CheckoutDeps, order: ClaimedOrder, session: GatewaySession): Promise<PayResult> {
  const settled = await settleSession(deps, order, session, 'resume')
  switch (settled.kind) {
    case 'open':
      return redirectTo(settled.session)
    case 'result':
      return settled.result
    case 'unknown':
      return unknownResult(settled)
    case 'closed':
      // Stripe has expired this checkout: record that here, then the family starts again
      await deps.store.expireCheckout({
        registrationId: order.id,
        claimId: order.checkout_claim_id,
        sessionId: session.id,
        account: order.checkout_config.account
      })
      return reread(deps, order)
  }
}

/** The claim never produced a session and never will (established by locateClaimSession). */
async function abandonClaim(deps: CheckoutDeps, order: ClaimedOrder, message: string): Promise<PayResult> {
  if (order.status === 'draft') {
    await deps.store.cancelOrder(order.id, order.household_id, order.checkout_claim_id)
  }
  return { kind: 'start_again', message }
}

// ─── Finding and settling a claim's session (spec §6a) ───

type Located = { kind: 'found'; session: GatewaySession } | { kind: 'none' } | { kind: 'unknown' }

/**
 * Finds the session this claim produced: by its id if attached, otherwise by listing the bound
 * account's sessions from the claim window. 'none' only once no create request can still be running.
 */
async function locateClaimSession(deps: CheckoutDeps, order: ClaimedOrder): Promise<Located> {
  const account = order.checkout_config.account
  if (order.stripe_checkout_session_id) {
    const session = await deps.stripe.retrieveCheckoutSession(order.stripe_checkout_session_id, account)
    return session ? { kind: 'found', session } : { kind: 'unknown' }
  }
  const claimedAt = new Date(order.checkout_claimed_at).getTime()
  const sessions = await deps.stripe.listClaimSessions(
    account,
    order.checkout_claim_id,
    new Date(claimedAt - CLAIM_LOOKUP_BEFORE_MS),
    new Date(claimedAt + CREATE_SETTLED_AFTER_MS)
  )
  if (!sessions) return { kind: 'unknown' }
  const mine = sessions.find((s) => s.metadata.registration_id === order.id)
  if (mine) return { kind: 'found', session: mine }
  return claimAge(deps, order) > CREATE_SETTLED_AFTER_MS ? { kind: 'none' } : { kind: 'unknown' }
}

type Settled =
  | { kind: 'open'; session: GatewaySession }
  | { kind: 'closed' }
  | { kind: 'result'; result: PayResult }
  | { kind: 'unknown'; paymentMayHaveHappened: boolean }

/**
 * The one place a claim's session is settled. Open: resume it, or expire it and check it expired.
 * Expired: it can't be paid. Complete and paid: confirm through the same checks as the webhook.
 * Anything else is unknown, and the order is kept.
 */
async function settleSession(
  deps: CheckoutDeps,
  order: ClaimedOrder,
  session: GatewaySession,
  intent: 'resume' | 'close'
): Promise<Settled> {
  let current = session
  if (current.status === 'open') {
    if (intent === 'resume') return { kind: 'open', session: current }
    const expired = await deps.stripe.expireCheckoutSession(current.id, order.checkout_config.account)
    if (expired.kind === 'unknown') return { kind: 'unknown', paymentMayHaveHappened: false }
    current = expired.session
  }
  if (current.status === 'expired') return { kind: 'closed' }
  if (current.paymentStatus === 'paid') {
    return { kind: 'result', result: await confirmFromSession(deps, order, current) }
  }
  // Complete without a payment: only a delayed payment method does this. Keep the order and check.
  return { kind: 'unknown', paymentMayHaveHappened: true }
}

function unknownResult(settled: { paymentMayHaveHappened: boolean }): PayResult {
  return {
    kind: 'try_again',
    message: settled.paymentMayHaveHappened ? reviewMessage('C', null) : CHECKOUT_MESSAGES.starting
  }
}

// ─── Confirmation from a session the server fetched itself ───

export function payResultFromConfirmation(result: ConfirmResult): PayResult {
  switch (result.result) {
    case 'confirmed':
    case 'already_confirmed':
      return { kind: 'paid', confirmationNumber: result.confirmation_number }
    case 'exception': {
      const code = reviewCodeForReason(result.reason) ?? 'C'
      const supportRef = code === 'A' ? result.support_ref : null
      return { kind: 'review', message: reviewMessage(code, supportRef), supportRef }
    }
    case 'not_paid':
      return { kind: 'try_again', message: reviewMessage('C', null) }
  }
}

async function confirmFromSession(
  deps: Pick<CheckoutDeps, 'store' | 'stripe'>,
  order: Pick<ClaimedOrder, 'id' | 'checkout_config'>,
  session: GatewaySession
): Promise<PayResult> {
  const account = order.checkout_config.account
  try {
    const chargeId = session.paymentIntentId ? await deps.stripe.latestChargeId(session.paymentIntentId, account) : null
    const result = await deps.store.confirmOrderPayment({
      registrationId: order.id,
      claimId: session.metadata.claim_id ?? null,
      sessionId: session.id,
      account,
      amountCents: session.amountTotal,
      currency: session.currency,
      paymentStatus: session.paymentStatus,
      paymentIntentId: session.paymentIntentId,
      chargeId,
      eventId: `sync:${session.id}`,
      source: 'sync'
    })
    return payResultFromConfirmation(result)
  } catch (err) {
    console.error(`[CHECKOUT] Confirming order ${order.id} from Stripe failed:`, err)
    return { kind: 'try_again', message: reviewMessage('C', null) }
  }
}

// ─── Cancel ───

function cancelResultFrom(result: PayResult): CancelResult {
  if (result.kind === 'paid' || result.kind === 'review' || result.kind === 'try_again' || result.kind === 'error') {
    return result
  }
  return { kind: 'try_again', message: CHECKOUT_MESSAGES.cancelLater }
}

export async function cancel(
  deps: CheckoutDeps,
  input: { registrationId: string; householdId: string }
): Promise<CancelResult> {
  // One re-read is allowed: a Pay click or the webhook may change the order underneath us
  for (let round = 0; round < 2; round++) {
    const order = await deps.store.getOrderForCheckout(input.registrationId, input.householdId)
    if (!order) return { kind: 'error', message: CHECKOUT_MESSAGES.notFound }
    if (order.status === 'paid') return { kind: 'paid', confirmationNumber: order.confirmation_number }
    if (order.status === 'expired' || order.status === 'cancelled') return { kind: 'cancelled' }

    if (!isClaimed(order)) {
      const result = await deps.store.cancelOrder(order.id, order.household_id, null)
      if (result.result === 'cancelled') return { kind: 'cancelled' }
      continue
    }

    // Never cancel on a guess: find the claim's session and settle it first (spec §7)
    const located = await locateClaimSession(deps, order)
    if (located.kind === 'unknown') return { kind: 'try_again', message: CHECKOUT_MESSAGES.cancelLater }
    if (located.kind === 'found') {
      const settled = await settleSession(deps, order, located.session, 'close')
      if (settled.kind === 'result') return cancelResultFrom(settled.result)
      if (settled.kind === 'unknown') {
        return {
          kind: 'try_again',
          message: settled.paymentMayHaveHappened ? reviewMessage('C', null) : CHECKOUT_MESSAGES.cancelLater
        }
      }
    }
    // Stripe confirms the checkout can't be paid, or it is established that none was ever made
    const result = await deps.store.cancelOrder(order.id, order.household_id, order.checkout_claim_id)
    if (result.result === 'cancelled') return { kind: 'cancelled' }
  }
  return { kind: 'try_again', message: CHECKOUT_MESSAGES.cancelLater }
}

// ─── The success page ───

/**
 * If Stripe says this order's checkout is complete but the order isn't paid, confirm it now.
 * It finds the order's own session by its claim; it never uses a session id from the URL.
 */
export async function syncConfirmation(
  deps: CheckoutDeps,
  input: { registrationId: string; householdId: string }
): Promise<PayResult | null> {
  const order = await deps.store.getOrderForCheckout(input.registrationId, input.householdId)
  if (!order) return null
  if (order.status === 'paid') return { kind: 'paid', confirmationNumber: order.confirmation_number }
  if (order.status === 'cancelled' || !isClaimed(order)) return null

  const located = await locateClaimSession(deps, order)
  if (located.kind !== 'found' || located.session.status !== 'complete') return null
  const settled = await settleSession(deps, order, located.session, 'resume')
  if (settled.kind === 'result') return settled.result
  if (settled.kind === 'unknown') return unknownResult(settled)
  return null
}
