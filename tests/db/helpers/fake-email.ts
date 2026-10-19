import type { EmailSender, OutgoingEmail, SendOutcome } from '@/app/_payments/email-sender'

/** Behaves like Resend with idempotency keys: one delivery per key, whatever the replies said */
export class FakeEmail implements EmailSender {
  readonly delivered: { key: string; email: OutgoingEmail; id: string }[] = []
  /** Forced outcomes for the next sends */
  next: Array<'reject' | 'uncertain-before' | 'uncertain-after'> = []
  private readonly byKey = new Map<string, string>()

  async send(email: OutgoingEmail, key: string): Promise<SendOutcome> {
    const forced = this.next.shift()
    if (forced === 'reject') return { kind: 'rejected', message: 'validation_error' }
    if (forced === 'uncertain-before') return { kind: 'uncertain', message: 'timeout before Resend' }
    let id = this.byKey.get(key)
    if (!id) {
      id = `em_${this.byKey.size + 1}`
      this.byKey.set(key, id)
      this.delivered.push({ key, email, id })
    }
    if (forced === 'uncertain-after') {
      return { kind: 'uncertain', message: 'timeout after Resend accepted it' }
    }
    return { kind: 'accepted', id }
  }
}
