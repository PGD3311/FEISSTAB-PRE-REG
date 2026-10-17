import { describe, expect, it } from 'vitest'
import {
  openReviewsByOrder,
  reviewCodeForReason,
  reviewMessage,
  type PaymentReview
} from '@/lib/payment-review-messages'

describe('parent review messages', () => {
  it('uses message A when the charge is verified but the registration is not resolved', () => {
    for (const reason of ['amount_mismatch', 'currency_mismatch', 'late_payment_conflict', 'order_not_payable']) {
      expect(reviewCodeForReason(reason)).toBe('A')
    }
    expect(reviewMessage('A', 'PAY-7KQ2M')).toBe(
      "Your payment went through, but we need to check your registration before confirming it. Please don't pay again. Your reference is PAY-7KQ2M. We'll email you."
    )
  })

  it('uses message B for a failed payment', () => {
    expect(reviewCodeForReason('payment_failed')).toBe('B')
    expect(reviewMessage('B', null)).toBe("Your payment didn't go through, so this registration isn't confirmed. You can try again.")
  })

  it('shows families nothing for cases where the payer may not be them', () => {
    for (const reason of ['account_mismatch', 'claim_mismatch', 'session_mismatch', 'payment_reused', 'order_not_found', 'listing_account_changed']) {
      expect(reviewCodeForReason(reason)).toBeNull()
    }
  })

  it('has message C for a payment that is still being checked', () => {
    expect(reviewMessage('C', null)).toBe("We're checking your payment. Please don't try again until this updates.")
  })
})

describe('openReviewsByOrder', () => {
  function review(overrides: Partial<PaymentReview> = {}): PaymentReview {
    return {
      registration_id: 'r1',
      support_ref: 'PAY-7KQ2M',
      message_code: 'A',
      created_at: '2026-10-16T12:00:00+00:00',
      resolved: false,
      ...overrides
    }
  }

  it("keeps each order's newest unresolved case, whatever order the rows come in", () => {
    const older = review({ support_ref: 'PAY-OLDER' })
    const newer = review({ support_ref: 'PAY-NEWER', created_at: '2026-10-16T13:00:00+00:00' })
    const other = review({ registration_id: 'r2', support_ref: 'PAY-OTHER', message_code: 'B' })
    for (const rows of [
      [newer, other, older],
      [older, other, newer]
    ]) {
      const open = openReviewsByOrder(rows)
      expect(open.get('r1')).toBe(newer)
      expect(open.get('r2')).toBe(other)
    }
  })

  it('shows nothing for a resolved case', () => {
    const resolvedLater = review({ created_at: '2026-10-16T13:00:00+00:00', resolved: true })
    expect(openReviewsByOrder([review({ resolved: true })]).size).toBe(0)
    expect(openReviewsByOrder([review(), resolvedLater]).get('r1')).toEqual(review())
  })
})
