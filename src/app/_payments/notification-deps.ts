import { emailIsConfigured } from '@/lib/email/email-config'
import { createServiceClient } from '@/lib/supabase/service'
import { createResendSender } from './email-sender'
import { createNotificationStore } from './notification-store'
import type { WorkerDeps } from './notification-worker'
import { supabaseRpc } from './rpc'

/** Email only runs when Resend, the sender address and the payments contacts are all set */
export function notificationDeps(): WorkerDeps {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM
  const alertRecipients = (process.env.PAYMENTS_ALERT_EMAIL ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean)
  // The same rule the success page uses to decide whether to promise an email
  const configured = emailIsConfigured(process.env)

  return {
    store: createNotificationStore(supabaseRpc(createServiceClient())),
    sender: configured ? createResendSender(apiKey!) : null,
    config: configured
      ? {
          from: from!,
          alertRecipients,
          baseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
        }
      : null,
    now: () => new Date(),
    log: (line) => console.log(line)
  }
}
