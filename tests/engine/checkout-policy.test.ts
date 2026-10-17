import { describe, expect, it } from 'vitest'
import {
  belowCardMinimum,
  CHECKOUT_BLOCK_MESSAGES,
  checkoutBlockReason,
  MIN_CHARGE_CENTS
} from '@/lib/engine/checkout-policy'

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

describe('belowCardMinimum', () => {
  it("is true below Stripe's 50-cent card minimum, and false from 50 cents up", () => {
    expect(MIN_CHARGE_CENTS).toBe(50)
    expect(belowCardMinimum(0)).toBe(true)
    expect(belowCardMinimum(49)).toBe(true)
    expect(belowCardMinimum(50)).toBe(false)
    expect(belowCardMinimum(4000)).toBe(false)
  })

  it('blocks Pay exactly where Submit refuses, with one message for both', () => {
    for (const totalCents of [0, 49, 50, 51]) {
      const blocked = checkoutBlockReason({ ...base, totalCents }) === 'amount_too_small'
      expect(blocked).toBe(belowCardMinimum(totalCents))
    }
    expect(CHECKOUT_BLOCK_MESSAGES.amount_too_small).toBe(
      'This order is too small to pay by card. Please contact the organiser.'
    )
  })
})
