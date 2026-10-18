import { describe, expect, it } from 'vitest'
import {
  messageAWasResolved,
  NEW_ORDER_CHECK_FAILED_MESSAGE,
  newOrderGate,
  openMessageAFor,
  openReviewsByOrder,
  REVIEWED_MESSAGE,
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

describe('openReviewsByOrder', () => {

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

describe('messageAWasResolved', () => {
  it('says so once the payments contacts have closed the order\'s message-A case', () => {
    expect(messageAWasResolved([review({ resolved: true })], 'r1')).toBe(true)
    expect(REVIEWED_MESSAGE).toBe(
      'This payment has been reviewed. If you have questions, contact the organiser.'
    )
  })

  it('keeps message A while any case on the order is still open', () => {
    expect(messageAWasResolved([review()], 'r1')).toBe(false)
    const openLater = review({ support_ref: 'PAY-NEWER', created_at: '2026-10-16T13:00:00+00:00' })
    expect(messageAWasResolved([review({ resolved: true }), openLater], 'r1')).toBe(false)
    const openB = review({ support_ref: 'PAY-FAILD', message_code: 'B' })
    expect(messageAWasResolved([review({ resolved: true }), openB], 'r1')).toBe(false)
  })

  it('says nothing for a closed message-B case, or for another order\'s case', () => {
    expect(messageAWasResolved([review({ message_code: 'B', resolved: true })], 'r1')).toBe(false)
    expect(messageAWasResolved([review({ registration_id: 'r2', resolved: true })], 'r1')).toBe(false)
    expect(messageAWasResolved([], 'r1')).toBe(false)
  })
})

// Decision 13: while the family has an open message-A case for a feis, no new order for it starts
describe('openMessageAFor', () => {
  it("finds the newest open message-A case on one of the feis's orders", () => {
    const newer = review({ registration_id: 'r2', support_ref: 'PAY-NEWER', created_at: '2026-10-16T13:00:00+00:00' })
    expect(openMessageAFor([review(), newer], ['r1', 'r2'])).toEqual(newer)
  })

  it("ignores message B, resolved cases and other feiseanna's orders", () => {
    expect(openMessageAFor([review({ message_code: 'B' })], ['r1'])).toBeNull()
    expect(openMessageAFor([review({ resolved: true })], ['r1'])).toBeNull()
    expect(openMessageAFor([review()], ['r9'])).toBeNull()
  })

  it('finds an open message-A case even when a newer open case on the same order is message B', () => {
    const newerB = review({ message_code: 'B', support_ref: 'PAY-B', created_at: '2026-10-16T13:00:00+00:00' })
    expect(openMessageAFor([review(), newerB], ['r1'])).toEqual(review())
  })
})

// Decision 13 on the server: Submit and Pay ask this before they make or pay an order
describe('newOrderGate', () => {
  it("refuses with message A and its reference while a case is open on another of the feis's orders", () => {
    const gate = newOrderGate({ registrationIds: ['r1', 'r2'], reviews: [review()] })
    expect(gate).toEqual({ allowed: false, message: reviewMessage('A', 'PAY-7KQ2M') })
    expect(gate.allowed === false && gate.message).toContain('PAY-7KQ2M')
  })

  it('names the newest open case when there are several', () => {
    const newer = review({ support_ref: 'PAY-NEWER', created_at: '2026-10-16T13:00:00+00:00' })
    expect(newOrderGate({ registrationIds: ['r1'], reviews: [review(), newer] })).toEqual({
      allowed: false,
      message: reviewMessage('A', 'PAY-NEWER')
    })
  })

  it('allows once the case is resolved, for message B alone, for another feis, or with no cases', () => {
    const allowed = { allowed: true }
    expect(newOrderGate({ registrationIds: ['r1'], reviews: [review({ resolved: true })] })).toEqual(allowed)
    expect(newOrderGate({ registrationIds: ['r1'], reviews: [review({ message_code: 'B' })] })).toEqual(allowed)
    expect(newOrderGate({ registrationIds: ['r9'], reviews: [review()] })).toEqual(allowed)
    expect(newOrderGate({ registrationIds: ['r1'], reviews: [] })).toEqual(allowed)
    expect(newOrderGate({ registrationIds: [], reviews: [] })).toEqual(allowed)
  })

  it("still refuses for an open message A when a closed one or a newer message B sits beside it", () => {
    const closedEarlier = review({ resolved: true, support_ref: 'PAY-CLOSED', created_at: '2026-10-16T11:00:00+00:00' })
    const newerB = review({ message_code: 'B', support_ref: 'PAY-B', created_at: '2026-10-16T13:00:00+00:00' })
    expect(newOrderGate({ registrationIds: ['r1'], reviews: [closedEarlier, review(), newerB] })).toEqual({
      allowed: false,
      message: reviewMessage('A', 'PAY-7KQ2M')
    })
  })

  it("fails closed when the orders or the cases couldn't be read", () => {
    expect(newOrderGate(null)).toEqual({ allowed: false, message: NEW_ORDER_CHECK_FAILED_MESSAGE })
    expect(NEW_ORDER_CHECK_FAILED_MESSAGE).toBe("We couldn't check your registration just now. Please try again.")
  })
})
