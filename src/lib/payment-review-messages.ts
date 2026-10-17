/** Parent-facing payment messages, worded exactly as in the payment hardening spec (§10). */
export type ReviewMessageCode = 'A' | 'B' | 'C'

const VERIFIED_CHARGE_REASONS = new Set([
  'amount_mismatch',
  'currency_mismatch',
  'late_payment_conflict',
  'order_not_payable'
])

/** null: the payer may not be this family, so only the payments contacts are told */
export function reviewCodeForReason(reason: string): ReviewMessageCode | null {
  if (reason === 'payment_failed') return 'B'
  return VERIFIED_CHARGE_REASONS.has(reason) ? 'A' : null
}

export function reviewMessage(code: ReviewMessageCode, supportRef: string | null): string {
  switch (code) {
    case 'A':
      return `Your payment went through, but we need to check your registration before confirming it. Please don't pay again.${
        supportRef ? ` Your reference is ${supportRef}.` : ''
      } We'll email you.`
    case 'B':
      return "Your payment didn't go through, so this registration isn't confirmed. You can try again."
    case 'C':
      return "We're checking your payment. Please don't try again until this updates."
  }
}

/** A row of get_my_payment_reviews(): all a parent may see of a payment case on their own order */
export interface PaymentReview {
  registration_id: string
  support_ref: string
  message_code: 'A' | 'B'
  created_at: string
  resolved: boolean
}

/**
 * Each order's newest unresolved case, from get_my_payment_reviews() rows in any order. A
 * resolved case shows nothing: the payments contacts have dealt with it and told the family.
 */
export function openReviewsByOrder(reviews: PaymentReview[]): Map<string, PaymentReview> {
  const open = new Map<string, PaymentReview>()
  for (const review of reviews) {
    if (review.resolved) continue
    const shown = open.get(review.registration_id)
    if (!shown || Date.parse(review.created_at) > Date.parse(shown.created_at)) {
      open.set(review.registration_id, review)
    }
  }
  return open
}

/** What the family sees in place of message A once the payments contacts have closed that case */
export const REVIEWED_MESSAGE =
  'This payment has been reviewed. If you have questions, contact the organiser.'

/**
 * Whether the payments contacts have closed a message-A case on this order (refunded it, for
 * example) and left no case open on it. Message A's "don't pay again" and "we'll email you" no
 * longer hold then, so REVIEWED_MESSAGE replaces it. A closed message-B case needs no words: no
 * money moved, and the order's own status says the rest.
 */
export function messageAWasResolved(reviews: PaymentReview[], registrationId: string): boolean {
  const mine = reviews.filter((review) => review.registration_id === registrationId)
  return (
    mine.some((review) => review.resolved && review.message_code === 'A') &&
    mine.every((review) => review.resolved)
  )
}
