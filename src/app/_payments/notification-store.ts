import type {
  ConfirmationEmailContext,
  DeliveryFailureContext,
  PaymentAlertContext
} from '@/lib/email/templates'
import type { RpcCaller } from './rpc'

export interface StoredEmail {
  from: string
  subject: string
  html: string
}

export interface NotificationRow {
  id: string
  kind: 'registration_confirmation' | 'payment_exception_alert' | 'delivery_failure_alert'
  dedupe_key: string
  registration_id: string | null
  recipient: string | null
  payload: StoredEmail | null
  status: string
  attempts: number
  send_generation: number
  claim_token: string
}

/** What get_notification_context returns */
export interface NotificationContext {
  kind: NotificationRow['kind']
  order: ({ id: string; status: string } & ConfirmationEmailContext['order']) | null
  listing: ConfirmationEmailContext['listing'] | null
  purchase: ConfirmationEmailContext['purchase']
  numbers: ConfirmationEmailContext['numbers']
  family: PaymentAlertContext['family']
  exception: PaymentAlertContext['exception'] | null
  failed_notification: DeliveryFailureContext['failed'] | null
}

export type CompleteOutcome = 'sent' | 'explicit_failure' | 'uncertain'
export type CompleteResult = 'sent' | 'retry_scheduled' | 'failed' | 'stale_claim'

export function createNotificationStore(rpc: RpcCaller) {
  return {
    async claim(limit: number, now: Date): Promise<NotificationRow[]> {
      const rows = await rpc('claim_notifications', { p_limit: limit, p_now: now.toISOString() })
      return (rows ?? []) as NotificationRow[]
    },

    async freeze(
      id: string,
      claimToken: string,
      recipient: string,
      payload: StoredEmail
    ): Promise<{ recipient: string; payload: StoredEmail } | null> {
      return (await rpc('freeze_notification', {
        p_id: id,
        p_claim_token: claimToken,
        p_recipient: recipient,
        p_payload: payload
      })) as { recipient: string; payload: StoredEmail } | null
    },

    async complete(input: {
      id: string
      claimToken: string
      outcome: CompleteOutcome
      providerMessageId: string | null
      error: string | null
      now: Date
    }): Promise<CompleteResult> {
      const result = (await rpc('complete_notification', {
        p_id: input.id,
        p_claim_token: input.claimToken,
        p_outcome: input.outcome,
        p_provider_message_id: input.providerMessageId,
        p_error: input.error,
        p_now: input.now.toISOString()
      })) as { result: CompleteResult }
      return result.result
    },

    async context(id: string): Promise<NotificationContext | null> {
      return (await rpc('get_notification_context', {
        p_notification_id: id
      })) as NotificationContext | null
    }
  }
}

export type NotificationStore = ReturnType<typeof createNotificationStore>
