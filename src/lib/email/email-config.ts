/**
 * Whether RunFeis sends email: Resend, the sender address and at least one payments contact must
 * all be set (spec §12). Until then confirmations wait in the queue unsent, so no page may tell a
 * family that one is on its way. Pass `process.env`; the notification worker uses the same rule.
 */
export function emailIsConfigured(env: Record<string, string | undefined>): boolean {
  const contacts = (env.PAYMENTS_ALERT_EMAIL ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean)
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM && contacts.length > 0)
}
