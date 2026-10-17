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
