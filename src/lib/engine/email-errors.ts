/**
 * How to treat a Resend error.
 * 'rejected': Resend refused it, so nothing was sent; a retry may use a new idempotency key.
 * 'uncertain': it may have been sent; retry only with the same key, inside Resend's 24-hour window.
 */
export function classifyEmailError(
  error: { statusCode?: number | null; name?: string } | null | undefined
): 'rejected' | 'uncertain' {
  const status = error?.statusCode ?? null
  if (status === null || status === 409 || status >= 500) return 'uncertain'
  return 'rejected'
}
