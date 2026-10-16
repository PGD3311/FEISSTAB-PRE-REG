import { describe, expect, it } from 'vitest'
import { checkoutBlockReason } from '@/lib/engine/checkout-policy'

const base = {
  listingStatus: 'open' as const, stripeAccountId: 'acct_1', competitionIds: ['c1'], enabledCompetitionIds: ['c1', 'c2'],
  totalCents: 4000,
}

describe('checkoutBlockReason', () => {
  it('lets a checkout start while the organiser keeps registration open, even after the deadline', () => {
    // Deadlines are not checked at Pay: a submitted order is a quote (spec §5)
    expect(checkoutBlockReason(base)).toBeNull()
  })
  it('stops new checkouts once the organiser closes registration', () => {
    expect(checkoutBlockReason({ ...base, listingStatus: 'closed' })).toBe('organiser_stopped')
  })
  it('stops new checkouts when a competition in the order is disabled', () => {
    expect(checkoutBlockReason({ ...base, enabledCompetitionIds: ['c2'] })).toBe('competition_unavailable')
  })
  it('needs a connected Stripe account', () => {
    expect(checkoutBlockReason({ ...base, stripeAccountId: null })).toBe('stripe_not_connected')
  })
  it('refuses totals below the minimum card charge', () => {
    expect(checkoutBlockReason({ ...base, totalCents: 49 })).toBe('amount_too_small')
  })
})
