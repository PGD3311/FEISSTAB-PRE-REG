import {
  confirmationEmail,
  renderDeliveryFailureAlertEmail,
  renderPaymentAlertEmail,
  type EmailContent
} from '@/lib/email/templates'
import type { EmailSender } from './email-sender'
import type {
  NotificationContext,
  NotificationRow,
  NotificationStore,
  StoredEmail
} from './notification-store'

export interface WorkerConfig {
  from: string
  alertRecipients: string[]
  baseUrl: string
}

export interface WorkerDeps {
  store: NotificationStore
  sender: EmailSender | null
  /** null while email isn't configured: nothing is claimed and no attempts are used */
  config: WorkerConfig | null
  now: () => Date
  log: (line: string) => void
}

export interface WorkerResult {
  paused: boolean
  claimed: number
  sent: number
}

function render(
  row: NotificationRow,
  ctx: NotificationContext | null,
  config: WorkerConfig
): EmailContent | null {
  if (!ctx) return null
  switch (row.kind) {
    case 'registration_confirmation':
      return ctx.order && ctx.listing
        ? confirmationEmail({
            order: ctx.order,
            listing: ctx.listing,
            purchase: ctx.purchase,
            numbers: ctx.numbers,
            baseUrl: config.baseUrl
          })
        : null
    case 'payment_exception_alert':
      return ctx.exception
        ? renderPaymentAlertEmail({
            exception: ctx.exception,
            listing: ctx.listing,
            family: ctx.family,
            order: ctx.order
          })
        : null
    case 'delivery_failure_alert':
      return ctx.failed_notification
        ? renderDeliveryFailureAlertEmail({
            failed: ctx.failed_notification,
            order: ctx.order,
            family: ctx.family
          })
        : null
  }
}

/** Sends due notifications (spec §12): at most once each within the provider's idempotency window. */
export async function processNotifications(
  deps: WorkerDeps,
  opts: { limit?: number } = {}
): Promise<WorkerResult> {
  const config = deps.config
  const sender = deps.sender
  if (!config || !sender) {
    deps.log(
      '[NOTIFICATIONS] email is paused: RESEND_API_KEY, EMAIL_FROM or PAYMENTS_ALERT_EMAIL is not set'
    )
    return { paused: true, claimed: 0, sent: 0 }
  }
  const rows = await deps.store.claim(opts.limit ?? 20, deps.now())
  let sent = 0

  for (const row of rows) {
    // One row that throws must not stall the rest. Its claim is left as it is: after 10 minutes a
    // later run takes it over, as it would a worker that stopped, and keeps its provider key
    try {
      if (await processRow(deps, sender, config, row)) sent++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      deps.log(`[NOTIFICATION_FAILED] ${row.id} ${message}`)
    }
  }

  return { paused: false, claimed: rows.length, sent }
}

/** One claimed row: render and freeze it on its first attempt, send it, record the outcome */
async function processRow(
  deps: WorkerDeps,
  sender: EmailSender,
  config: WorkerConfig,
  row: NotificationRow
): Promise<boolean> {
  let frozen: { recipient: string; payload: StoredEmail } | null =
    row.recipient && row.payload ? { recipient: row.recipient, payload: row.payload } : null

  if (!frozen) {
    // First attempt: render once, then freeze the recipient and message for every later attempt
    const content = render(row, await deps.store.context(row.id), config)
    const recipient =
      row.kind === 'registration_confirmation' ? row.recipient : config.alertRecipients.join(',')
    if (!content || !recipient) {
      await deps.store.complete({
        id: row.id,
        claimToken: row.claim_token,
        outcome: 'explicit_failure',
        providerMessageId: null,
        error: content ? 'no recipient' : 'nothing to render',
        now: deps.now()
      })
      return false
    }
    frozen = await deps.store.freeze(row.id, row.claim_token, recipient, {
      from: config.from,
      subject: content.subject,
      html: content.html
    })
    if (!frozen) {
      deps.log(`[NOTIFICATIONS] claim on ${row.id} went stale before sending`)
      return false
    }
  }

  const outcome = await sender.send(
    {
      from: frozen.payload.from,
      to: frozen.recipient
        .split(',')
        .map((address) => address.trim())
        .filter(Boolean),
      subject: frozen.payload.subject,
      html: frozen.payload.html
    },
    `${row.dedupe_key}:${row.send_generation}`
  )
  const result = await deps.store.complete({
    id: row.id,
    claimToken: row.claim_token,
    outcome:
      outcome.kind === 'accepted'
        ? 'sent'
        : outcome.kind === 'rejected'
          ? 'explicit_failure'
          : 'uncertain',
    providerMessageId: outcome.kind === 'accepted' ? outcome.id : null,
    error: outcome.kind === 'accepted' ? null : outcome.message,
    now: deps.now()
  })
  if (result === 'stale_claim') {
    deps.log(`[NOTIFICATIONS] ${row.id} was claimed again while sending; the newer claim stands`)
  }
  if (result === 'failed') deps.log(`[NOTIFICATION_FAILED] ${row.kind} ${row.id}`)
  if (result === 'needs_check') {
    deps.log(`[NOTIFICATION_FAILED] ${row.kind} ${row.id} may have been sent; a person must check`)
  }
  return outcome.kind === 'accepted'
}
