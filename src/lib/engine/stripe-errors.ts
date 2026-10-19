/**
 * What one failed Stripe call says about that request. It never says what an earlier attempt with
 * the same idempotency key did: Stripe can cache a 500 even when the session was made.
 * - 'in_progress': the same key is still being processed; retry later with the same key
 * - 'retry': the outcome is unknown (network, Stripe 5xx, rate limit); retry with the same key
 * - 'rejected': Stripe refused this request (bad parameters, a key reused with different
 *   parameters, authentication, permissions)
 * When attempts end without a session, the workflow looks the session up (spec §6a).
 */
export type StripeFailure = 'in_progress' | 'retry' | 'rejected'

export function classifyStripeError(err: unknown): StripeFailure {
  const e = (err ?? {}) as { type?: string; code?: string; statusCode?: number }
  if (e.code === 'idempotency_key_in_use' || e.statusCode === 409) return 'in_progress'
  switch (e.type) {
    case 'StripeConnectionError':
    case 'StripeAPIError':
    case 'StripeRateLimitError':
      return 'retry'
    case 'StripeInvalidRequestError':
    case 'StripeCardError':
    case 'StripeAuthenticationError':
    case 'StripePermissionError':
    case 'StripeIdempotencyError':
      return 'rejected'
  }
  if (typeof e.statusCode === 'number') {
    return e.statusCode >= 500 || e.statusCode === 429 ? 'retry' : 'rejected'
  }
  return 'retry'
}
