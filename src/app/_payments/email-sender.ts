import { Resend } from 'resend'
import { classifyEmailError } from '@/lib/engine/email-errors'

export interface OutgoingEmail {
  from: string
  to: string[]
  subject: string
  html: string
}

export type SendOutcome =
  | { kind: 'accepted'; id: string }
  | { kind: 'rejected'; message: string }
  | { kind: 'uncertain'; message: string }

export interface EmailSender {
  send(email: OutgoingEmail, idempotencyKey: string): Promise<SendOutcome>
}

export function createResendSender(apiKey: string): EmailSender {
  const resend = new Resend(apiKey)
  return {
    async send(email, idempotencyKey) {
      try {
        const { data, error } = await resend.emails.send(email, { idempotencyKey })
        if (error) {
          return classifyEmailError(error) === 'rejected'
            ? { kind: 'rejected', message: error.message }
            : { kind: 'uncertain', message: error.message }
        }
        return data?.id
          ? { kind: 'accepted', id: data.id }
          : { kind: 'uncertain', message: 'Resend returned no message id' }
      } catch (err) {
        return { kind: 'uncertain', message: err instanceof Error ? err.message : String(err) }
      }
    }
  }
}
