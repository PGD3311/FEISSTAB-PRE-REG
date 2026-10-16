import type { ListingStatus } from '@/lib/types/feis-listing'

export const MIN_CHARGE_CENTS = 50

export type CheckoutBlock =
  'organiser_stopped' | 'competition_unavailable' | 'stripe_not_connected' | 'amount_too_small'

export const CHECKOUT_BLOCK_MESSAGES: Record<CheckoutBlock, string> = {
  organiser_stopped: 'Registration has been closed by the organiser.',
  competition_unavailable:
    'A competition in this registration is no longer available. Please cancel it and start again.',
  stripe_not_connected:
    "The organiser hasn't finished setting up payments yet. Please try again later.",
  amount_too_small:
    'This registration is below the minimum card payment. Please contact the organiser.'
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
  if (input.totalCents < MIN_CHARGE_CENTS) return 'amount_too_small'
  return null
}
