import { adminAlertRecipients } from '@/lib/approval-gate'
import { emailIsConfigured } from '@/lib/email/email-config'
import type { EmailContent } from '@/lib/email/templates'
import { redactWithEnv, safeErrorMessage } from '@/lib/redact-secrets'
import { createServiceClient } from '@/lib/supabase/service'
import { createResendSender } from '@/app/_payments/email-sender'

/** Where the links in approval emails point */
export function approvalEmailBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
}

/**
 * Sends one approval-gate email. It never throws and never blocks the action that called it:
 * without email set up (the same rule as every other RunFeis email, `emailIsConfigured`) it
 * logs and skips, and a failed send is logged as [ADMIN_EMAIL_FAILED].
 */
export async function sendApprovalEmail(
  to: string[] | 'admins',
  content: EmailContent,
  idempotencyKey: string
): Promise<void> {
  try {
    if (!emailIsConfigured(process.env)) {
      console.log(`[ADMIN_EMAIL_SKIPPED] email is not set up: ${idempotencyKey}`)
      return
    }
    const recipients = to === 'admins' ? adminAlertRecipients(process.env) : to
    if (recipients.length === 0) {
      console.log(`[ADMIN_EMAIL_SKIPPED] no one to send to: ${idempotencyKey}`)
      return
    }
    const sender = createResendSender(process.env.RESEND_API_KEY!)
    const outcome = await sender.send(
      { from: process.env.EMAIL_FROM!, to: recipients, ...content },
      idempotencyKey
    )
    if (outcome.kind !== 'accepted') {
      console.error(`[ADMIN_EMAIL_FAILED] ${idempotencyKey}: ${redactWithEnv(outcome.message)}`)
    }
  } catch (err) {
    console.error(`[ADMIN_EMAIL_FAILED] ${idempotencyKey}: ${safeErrorMessage(err)}`)
  }
}

/**
 * An organiser's sign-in email, read with the service client (auth.users is not readable
 * otherwise). Null when it can't be read; the caller shows or sends without it.
 */
export async function organiserEmail(userId: string | null): Promise<string | null> {
  if (!userId) return null
  try {
    const { data, error } = await createServiceClient().auth.admin.getUserById(userId)
    if (error) {
      console.error(`Failed to read organiser email for ${userId}: ${redactWithEnv(error.message)}`)
      return null
    }
    return data.user?.email ?? null
  } catch (err) {
    console.error(`Failed to read organiser email for ${userId}: ${safeErrorMessage(err)}`)
    return null
  }
}
