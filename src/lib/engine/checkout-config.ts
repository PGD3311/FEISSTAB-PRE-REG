import type { PurchaseSnapshot } from '@/lib/engine/purchase-snapshot'

export const CHECKOUT_WINDOW_MINUTES = 60
export const HOLD_AFTER_CHECKOUT_MINUTES = 15

export interface CheckoutLineItem {
  name: string
  amount_cents: number
}

/** The complete Stripe Checkout request for one claim, frozen when the claim is made (spec §6). */
export interface CheckoutConfig {
  version: 1
  account: string
  currency: 'usd'
  total_cents: number
  application_fee_cents: number
  line_items: CheckoutLineItem[]
  success_url: string
  cancel_url: string
  /** Unix seconds */
  expires_at: number
  payment_method_types: ['card']
  client_reference_id: string
  metadata: { registration_id: string; claim_id: string }
  idempotency_key: string
}

export interface CheckoutConfigInput {
  registrationId: string
  feisListingId: string
  claimId: string
  account: string
  totalCents: number
  applicationFeeCents: number
  eventFeeCents: number
  snapshot: PurchaseSnapshot
  baseUrl: string
  now: Date
}

/** Stripe Checkout takes at most 100 line items in payment mode */
export const MAX_CHECKOUT_LINE_ITEMS = 100

function sum(amounts: number[]): number {
  return amounts.reduce((total, amount) => total + amount, 0)
}

/**
 * Stripe's lines for an order: the event fee, each dance at its own fee, then the late fee and the
 * day-of surcharge as lines of their own, as on the receipt. Zero-amount lines are left out.
 */
export function checkoutLineItems(
  snapshot: PurchaseSnapshot,
  eventFeeCents: number,
  totalCents: number
): CheckoutLineItem[] {
  const dancers = new Map(snapshot.dancers.map((d) => [d.id, d]))
  const competitions = new Map(snapshot.competitions.map((c) => [c.id, c]))
  const firstName = (dancerId: string) => dancers.get(dancerId)?.first_name ?? 'Dancer'

  const entryLines: CheckoutLineItem[] = []
  for (const entry of snapshot.entries) {
    if (entry.base_fee_cents === 0) continue
    const competition = competitions.get(entry.competition_id)
    const label = [competition?.display_code, competition?.display_name].filter(Boolean).join(' ')
    entryLines.push({
      name: `${firstName(entry.dancer_id)}: ${label || 'Competition entry'}`,
      amount_cents: entry.base_fee_cents
    })
  }

  const lateFeeCents = sum(snapshot.entries.map((e) => e.late_fee_cents))
  const dayOfCents = sum(snapshot.entries.map((e) => e.day_of_surcharge_cents))
  const withFees = (dances: CheckoutLineItem[]): CheckoutLineItem[] => [
    ...(eventFeeCents > 0 ? [{ name: 'Event fee (per family)', amount_cents: eventFeeCents }] : []),
    ...dances,
    ...(lateFeeCents > 0 ? [{ name: 'Late fee', amount_cents: lateFeeCents }] : []),
    ...(dayOfCents > 0 ? [{ name: 'Day-of surcharge', amount_cents: dayOfCents }] : [])
  ]

  const itemised = withFees(entryLines)
  // Stripe has no negative line items, so a family-max discount becomes one line at the capped total
  // Any mismatch is the cap: create_order's totals identity makes sum minus total the cap savings
  if (sum(itemised.map((line) => line.amount_cents)) !== totalCents) {
    return [{ name: 'Feis entries (family maximum applied)', amount_cents: totalCents }]
  }
  if (itemised.length <= MAX_CHECKOUT_LINE_ITEMS) return itemised

  // Too many dances for Stripe's limit: one line per dancer, keeping the fee lines
  const perDancer = new Map<string, { dances: number; cents: number }>()
  for (const entry of snapshot.entries) {
    const soFar = perDancer.get(entry.dancer_id) ?? { dances: 0, cents: 0 }
    perDancer.set(entry.dancer_id, {
      dances: soFar.dances + 1,
      cents: soFar.cents + entry.base_fee_cents
    })
  }
  const byDancer = withFees(
    [...perDancer]
      .filter(([, { cents }]) => cents > 0)
      .map(([dancerId, { dances, cents }]) => ({
        name: `${firstName(dancerId)}: ${dances} ${dances === 1 ? 'dance' : 'dances'}`,
        amount_cents: cents
      }))
  )
  if (byDancer.length <= MAX_CHECKOUT_LINE_ITEMS) return byDancer

  // Still too many: one line for the whole order
  return [{ name: 'Feis entries', amount_cents: totalCents }]
}

export function buildCheckoutConfig(input: CheckoutConfigInput): CheckoutConfig {
  return {
    version: 1,
    account: input.account,
    currency: 'usd',
    total_cents: input.totalCents,
    application_fee_cents: input.applicationFeeCents,
    line_items: checkoutLineItems(input.snapshot, input.eventFeeCents, input.totalCents),
    success_url: `${input.baseUrl}/feiseanna/${input.feisListingId}/register/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.baseUrl}/feiseanna/${input.feisListingId}/register`,
    expires_at: Math.floor(input.now.getTime() / 1000) + CHECKOUT_WINDOW_MINUTES * 60,
    payment_method_types: ['card'],
    client_reference_id: input.registrationId,
    metadata: { registration_id: input.registrationId, claim_id: input.claimId },
    idempotency_key: `checkout:${input.registrationId}:${input.claimId}`
  }
}
