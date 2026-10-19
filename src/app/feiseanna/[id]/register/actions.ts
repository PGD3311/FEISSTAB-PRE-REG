'use server'

import { headers } from 'next/headers'
import { after } from 'next/server'
import { createClient, getSignedInUser } from '@/lib/supabase/server'
import { createServiceClient, type ServiceClient } from '@/lib/supabase/service'
import {
  CHECKOUT_BLOCK_MESSAGES,
  PAID_ORDERS_CHANGED_MESSAGE,
  tooSmallToCharge
} from '@/lib/engine/checkout-policy'
import { clientIpFrom } from '@/lib/engine/consent'
import {
  validateOrderRequest,
  type OrderDancer,
  type RequestedEntry
} from '@/lib/engine/order-validation'
import {
  buildCreateOrderPayload,
  paidOrdersFrom,
  priceOrder,
  type CreateOrderPayload,
  type PaidOrderRow
} from '@/lib/engine/purchase-snapshot'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { isHouseholdComplete, REQUIRED_HOUSEHOLD_FIELDS } from '@/lib/household'
import { checkoutDeps } from '@/app/_payments/checkout-deps'
import { cancel, pay, type CancelResult, type PayResult } from '@/app/_payments/checkout-workflow'
import { notificationDeps } from '@/app/_payments/notification-deps'
import { processNotifications } from '@/app/_payments/notification-worker'
import type { NewOrderGate } from '@/lib/payment-review-messages'
import { REGISTRATION_COLUMNS } from '@/lib/registration-columns'
import {
  checkNewOrderGate,
  userClientNewOrderReader,
  type NewOrderTarget
} from '@/app/_payments/new-order-gate'
import { createOrderStore, type CreateOrderResult } from '@/app/_payments/order-store'
import { supabaseRpc } from '@/app/_payments/rpc'
import type {
  FeeBreakdown,
  FeeSchedule,
  FeisCompetition,
  FeisListing,
  Household,
  Registration,
  RegistrationEntry
} from '@/lib/types/feis-listing'

type RefusalReason = Extract<CreateOrderResult, { status: 'refused' }>['reason']

/** What a family is told when create_order refuses after the checks here have passed */
const REFUSAL_MESSAGES: Record<RefusalReason, string> = {
  listing_closed: 'Registration for this feis is not open.',
  outside_window: 'Registration for this feis has closed.',
  amount_too_small: CHECKOUT_BLOCK_MESSAGES.amount_too_small,
  unpaid_order_exists:
    'You already have entries waiting for payment at this feis. Reload this page to see them.',
  already_entered:
    'One of these dances is already entered and paid for. Reload this page to see your entries.',
  paid_orders_changed: PAID_ORDERS_CHANGED_MESSAGE
}

type SignedInHousehold = {
  supabase: Awaited<ReturnType<typeof createClient>>
  household: Pick<Household, 'id' | (typeof REQUIRED_HOUSEHOLD_FIELDS)[number]>
}
type HouseholdContext = { error: string } | SignedInHousehold

/**
 * The signed-in parent's household, read with their own client: this is what proves an order
 * is theirs (spec §4, §6, §7).
 */
async function currentHousehold(): Promise<HouseholdContext> {
  const supabase = await createClient()
  const user = await getSignedInUser(supabase)
  if (!user) return { error: 'Please sign in again to continue.' }

  const { data: household, error } = await supabase
    .from('households')
    .select('id, first_name, last_name, phone, address_line1, city, state_region, postal_code')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) return { error: 'Your family details could not be loaded. Please try again.' }
  if (!household) return { error: 'Please finish setting up your family account first.' }
  return { supabase, household }
}

/**
 * Decision 13 on the server (spec §14): Submit and Pay refuse while the family has an open
 * message-A case for the feis, even from an entry page opened before the case existed.
 * `checkNewOrderGate` judges it, from reads made with the family's own client. `order` names the
 * feis, or an order of the family's whose feis is looked up.
 */
function newOrderGateFor(ctx: SignedInHousehold, order: NewOrderTarget): Promise<NewOrderGate> {
  return checkNewOrderGate(userClientNewOrderReader(ctx.supabase, ctx.household.id), order)
}

/**
 * The family's unpaid order for this feis while it still holds its places. Read-only: a hold
 * that has passed already counts as expired here, and the expiry job makes the change (spec §13).
 */
export async function getExistingRegistration(feisListingId: string): Promise<
  | { error: string }
  | {
      registration: (Registration & { registration_entries: RegistrationEntry[] }) | null
      expired?: true
    }
> {
  const ctx = await currentHousehold()
  if ('error' in ctx) return { error: ctx.error }

  const { data: registration, error } = await ctx.supabase
    .from('registrations')
    .select(`${REGISTRATION_COLUMNS}, registration_entries(*)`)
    .eq('feis_listing_id', feisListingId)
    .eq('household_id', ctx.household.id)
    .in('status', ['draft', 'pending_payment'])
    .maybeSingle()
  if (error) return { error: 'Your entries could not be loaded. Please try again.' }
  if (!registration) return { registration: null }

  if (registration.hold_expires_at && new Date(registration.hold_expires_at) <= new Date()) {
    return { registration: null, expired: true }
  }
  return {
    registration: registration as Registration & { registration_entries: RegistrationEntry[] }
  }
}

/** What Submit checks and prices an order against, read fresh with the service role */
async function loadOrderInputs(service: ServiceClient, feisListingId: string, householdId: string) {
  const [listing, feeSchedule, dancers, competitions, paidOrders] = await Promise.all([
    service.from('feis_listings').select('*').eq('id', feisListingId).maybeSingle(),
    service.from('fee_schedules').select('*').eq('feis_listing_id', feisListingId).maybeSingle(),
    service
      .from('dancers')
      .select('*, dance_levels:dancer_dance_levels(dance_key, level_key)')
      .eq('household_id', householdId),
    // Every competition of this feis, enabled or not, since eligibility is judged against the
    // whole list. Read in pages: PostgREST returns at most 1000 rows per request.
    fetchAllRows<FeisCompetition>((from, to) =>
      service
        .from('feis_competitions')
        .select('*', { count: 'exact' })
        .eq('feis_listing_id', feisListingId)
        .order('id', { ascending: true })
        .range(from, to)
    ),
    // The family's paid orders for this feis: a new order is priced on top of them (spec §4)
    service
      .from('registrations')
      .select(
        'id, confirmation_number, event_fee_cents, application_fee_cents, purchase_snapshot, registration_entries(dancer_id, feis_competition_id, base_fee_cents, late_fee_cents)'
      )
      .eq('feis_listing_id', feisListingId)
      .eq('household_id', householdId)
      .eq('status', 'paid')
  ])
  const failed = listing.error ?? feeSchedule.error ?? dancers.error ?? paidOrders.error
  if (failed) throw new Error(failed.message)
  return {
    listing: listing.data as FeisListing | null,
    feeSchedule: feeSchedule.data as FeeSchedule | null,
    dancers: (dancers.data ?? []) as OrderDancer[],
    competitions,
    paidOrderRows: (paidOrders.data ?? []) as unknown as PaidOrderRow[]
  }
}

interface CreateDraftInput {
  feisListingId: string
  entries: RequestedEntry[]
  /** The family ticked the agreement. The server records when, and from which address. */
  consentAccepted: boolean
}

/** Submit (spec §4): check, price and create the order on the server, in one database step */
export async function createDraftRegistration(
  input: CreateDraftInput
): Promise<
  | { error: string }
  | { registrationId: string; totalCents: number; holdExpiresAt: string; breakdown: FeeBreakdown }
> {
  if (input.consentAccepted !== true) return { error: 'Please accept the terms to continue.' }

  const ctx = await currentHousehold()
  if ('error' in ctx) return { error: ctx.error }
  if (!isHouseholdComplete(ctx.household)) {
    return { error: 'Please add your family details (name, phone and address) before registering.' }
  }

  // No new order while a message-A case is open, even from a page opened before it (Decision 13)
  const gate = await newOrderGateFor(ctx, { feisListingId: input.feisListingId })
  if (!gate.allowed) return { error: gate.message }

  const service = createServiceClient()
  const loaded = await loadOrderInputs(service, input.feisListingId, ctx.household.id).catch(
    (err: unknown) => {
      console.error('Submit could not load the feis:', err)
      return null
    }
  )
  if (!loaded) return { error: 'The feis details could not be loaded. Please try again.' }
  const { listing, feeSchedule, dancers, competitions, paidOrderRows } = loaded
  if (!listing) return { error: 'This feis could not be found.' }
  if (!feeSchedule) return { error: "This feis hasn't set its fees yet, so entries can't be paid." }

  const now = new Date()
  const levels = listing.syllabus_snapshot?.levels ?? []
  // What the family's paid orders covered, each entry with its own order's family-max flag
  const paidOrders = paidOrdersFrom(paidOrderRows, competitions)
  const validation = validateOrderRequest({
    now,
    householdId: ctx.household.id,
    listing: { ...listing, levels },
    dancers,
    competitions,
    entries: input.entries,
    paidOrders
  })
  if (!validation.ok) return { error: validation.error }

  let payload: CreateOrderPayload
  let breakdown: FeeBreakdown
  try {
    const priced = priceOrder({
      now,
      ageCutoffDate: validation.ageCutoffDate,
      levels,
      feisTermsUrl: listing.terms_url,
      dancers,
      competitions,
      entries: input.entries,
      feeSchedule,
      paidOrders
    })
    payload = buildCreateOrderPayload(priced, {
      // RunFeis's flat fee goes on the family's first paid order only, so it reads the same paid
      // orders the price was counted on. create_order refuses if they changed since (spec §4)
      paidOrders,
      consentIp: clientIpFrom(await headers())
    })
    breakdown = priced.breakdown
  } catch (err) {
    console.error('Submit could not price the order:', err)
    return { error: 'Your entries could not be priced. Please try again later.' }
  }

  // Stripe can't take a card payment of 1 to 49 cents, so no order is made that could never be paid
  // (Decision 10); create_order refuses it too. A $0 order is made: Pay confirms it without Stripe.
  if (tooSmallToCharge(payload.total_cents)) {
    return { error: CHECKOUT_BLOCK_MESSAGES.amount_too_small }
  }

  try {
    const result = await createOrderStore(supabaseRpc(service)).createOrder(
      ctx.household.id,
      input.feisListingId,
      payload
    )
    if (result.status === 'refused') return { error: REFUSAL_MESSAGES[result.reason] }
    return {
      registrationId: result.registration_id,
      totalCents: payload.total_cents,
      holdExpiresAt: result.hold_expires_at,
      breakdown
    }
  } catch (err) {
    console.error('create_order failed:', err)
    return { error: 'Your entries could not be saved. Please try again.' }
  }
}

/** Pay (spec §6): start or resume this order's one checkout, or settle what Stripe already has */
export async function createCheckoutSession(registrationId: string): Promise<PayResult> {
  const ctx = await currentHousehold()
  if ('error' in ctx) return { kind: 'error', message: ctx.error }
  // Message A says not to pay again: no Pay, not even for a $0 order or one already held
  // (Decision 13)
  const gate = await newOrderGateFor(ctx, { registrationId })
  if (!gate.allowed) return { kind: 'blocked', message: gate.message }
  try {
    const result = await pay(checkoutDeps(), { registrationId, householdId: ctx.household.id })
    if (result.kind === 'paid') {
      // A confirmation queues its email. Send it now as a best effort, as the webhook does: a $0 order
      // has no webhook, and the 5-minute job retries anything that fails
      after(() =>
        processNotifications(notificationDeps(), { limit: 5 }).catch((err) =>
          console.error('[NOTIFICATIONS] immediate send failed:', err)
        )
      )
    }
    return result
  } catch (err) {
    console.error('Pay failed:', err)
    return { kind: 'error', message: "Payment couldn't start. Please try again in a moment." }
  }
}

/** Cancel (spec §7): close this order's checkout first, then cancel; never on a guess */
export async function cancelRegistration(registrationId: string): Promise<CancelResult> {
  const ctx = await currentHousehold()
  if ('error' in ctx) return { kind: 'error', message: ctx.error }
  try {
    return await cancel(checkoutDeps(), { registrationId, householdId: ctx.household.id })
  } catch (err) {
    console.error('Cancel failed:', err)
    return {
      kind: 'error',
      message: "Your entries couldn't be reopened. Please try again in a moment."
    }
  }
}
