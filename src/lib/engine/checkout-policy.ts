import type { ListingStatus } from '@/lib/types/feis-listing'

/** Stripe's smallest card charge in US dollars */
export const MIN_CHARGE_CENTS = 50

/**
 * Whether an order's total is too small to pay by card. claim_checkout blocks such an order
 * (amount_too_small); a $0 order never claims a checkout, because Pay confirms it without Stripe.
 */
export function belowCardMinimum(totalCents: number): boolean {
  return totalCents < MIN_CHARGE_CENTS
}

/**
 * Whether Submit refuses a total (Decision 10): 1 to 49 cents is more than nothing but less than a
 * card can be charged, so no order is made that could never be paid. create_order refuses it too. A
 * total of 0 is allowed: Pay confirms it without Stripe (spec §6).
 */
export function tooSmallToCharge(totalCents: number): boolean {
  return totalCents > 0 && belowCardMinimum(totalCents)
}

/**
 * create_order's paid_orders_changed: a paid order appeared, or changed what this one should count,
 * after Submit read them. Pay says the same when a $0 order's counted orders no longer hold.
 */
export const PAID_ORDERS_CHANGED_MESSAGE =
  'Your entries for this feis changed while you were choosing. Reload this page and check the total.'

export type CheckoutBlock =
  'organiser_stopped' | 'competition_unavailable' | 'stripe_not_connected' | 'amount_too_small'

export const CHECKOUT_BLOCK_MESSAGES: Record<CheckoutBlock, string> = {
  organiser_stopped: 'Registration has been closed by the organiser.',
  competition_unavailable:
    'One of your competitions is no longer offered. Choose Change entries and pick again.',
  stripe_not_connected:
    "The organiser hasn't finished setting up payments yet. Please try again later.",
  amount_too_small: 'This order is too small to pay by card. Please contact the organiser.'
}

/**
 * Whether a new checkout may start for a submitted order (spec §5). Deadlines are not checked
 * here: a submitted order is a quote that can be paid within its hold.
 */
export function checkoutBlockReason(input: {
  listingStatus: ListingStatus
  stripeAccountId: string | null
  competitionIds: string[]
  enabledCompetitionIds: string[]
  totalCents: number
}): CheckoutBlock | null {
  if (input.listingStatus !== 'open') return 'organiser_stopped'
  const enabled = new Set(input.enabledCompetitionIds)
  if (input.competitionIds.some((id) => !enabled.has(id))) return 'competition_unavailable'
  if (!input.stripeAccountId) return 'stripe_not_connected'
  if (belowCardMinimum(input.totalCents)) return 'amount_too_small'
  return null
}
