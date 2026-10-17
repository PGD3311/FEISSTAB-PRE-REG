import { randomUUID } from 'node:crypto'
import type { CheckoutConfig } from '@/lib/engine/checkout-config'
import type { StripeFailure } from '@/lib/engine/stripe-errors'
import {
  checkoutSessionParams,
  type CreateSessionOutcome,
  type ExpireSessionOutcome,
  type GatewaySession,
  type StripeGateway
} from '@/app/_payments/stripe-gateway'

type StoredSession = GatewaySession & { account: string; created: number }

type ForcedCreate =
  | 'retry-before' // Stripe never saw the request
  | 'retry-after' // Stripe made the session, but the reply was lost
  | 'cached-500' // Stripe made the session, answered 500, and replays that 500 for this key
  | 'in-progress' // another request with this key is still running
  | 'reject' // Stripe refuses, and replays the refusal for this key

/**
 * Behaves like Stripe where it matters here:
 * - the same idempotency key with the same parameters returns the stored result, including a stored
 *   refusal or a cached 500
 * - the same key with different parameters is refused
 * - a new session must expire at least 30 minutes after it is made
 * - complete sessions can't be expired
 */
export class FakeStripe implements StripeGateway {
  readonly sessions = new Map<string, StoredSession>()
  nextCreate: ForcedCreate[] = []
  /** Make every list call fail, as if Stripe were unreachable */
  listFails = false
  createCalls = 0
  private readonly byKey = new Map<string, { params: string; outcome: CreateSessionOutcome }>()
  private counter = 0
  /** Unique to this fake, so no two fakes make the same session id (the database refuses one session on two orders) */
  private readonly idPrefix = `cs_test_${randomUUID().slice(0, 8)}_`

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** The id of the nth session this fake made, counting from 1 */
  sessionId(n = 1): string {
    return `${this.idPrefix}${n}`
  }

  async createCheckoutSession(config: CheckoutConfig): Promise<CreateSessionOutcome> {
    this.createCalls++
    const forced = this.nextCreate.shift()
    if (forced === 'retry-before') return this.failure('retry', 'connection reset before Stripe')
    if (forced === 'in-progress') return this.failure('in_progress', 'idempotency_key_in_use')

    const params = JSON.stringify(checkoutSessionParams(config)) + config.account
    const stored = this.byKey.get(config.idempotency_key)
    if (stored) {
      if (stored.params !== params) {
        return this.failure('rejected', 'Keys for idempotent requests can only be used with the same parameters')
      }
      return stored.outcome
    }

    if (forced === 'reject') {
      const refusal = this.failure('rejected', 'Your account cannot currently make live charges.')
      this.byKey.set(config.idempotency_key, { params, outcome: refusal })
      return refusal
    }
    if (config.expires_at * 1000 < this.now().getTime() + 30 * 60_000) {
      return this.failure('rejected', 'expires_at must be at least 30 minutes in the future')
    }

    const session = this.makeSession(config)
    if (forced === 'cached-500') {
      const serverError = this.failure('retry', 'Stripe API error (500)')
      this.byKey.set(config.idempotency_key, { params, outcome: serverError })
      return serverError
    }
    const created: CreateSessionOutcome = { kind: 'created', session: this.view(session) }
    this.byKey.set(config.idempotency_key, { params, outcome: created })
    if (forced === 'retry-after') return this.failure('retry', 'reply lost after Stripe made the session')
    return created
  }

  async retrieveCheckoutSession(sessionId: string, account: string): Promise<GatewaySession | null> {
    const session = this.sessions.get(sessionId)
    return session && session.account === account ? this.view(session) : null
  }

  async listClaimSessions(account: string, claimId: string, createdFrom: Date, createdTo: Date): Promise<GatewaySession[] | null> {
    if (this.listFails) return null
    return [...this.sessions.values()]
      .filter((s) =>
        s.account === account && s.metadata.claim_id === claimId &&
        s.created >= createdFrom.getTime() && s.created <= createdTo.getTime())
      .map((s) => this.view(s))
  }

  async expireCheckoutSession(sessionId: string, account: string): Promise<ExpireSessionOutcome> {
    const session = this.sessions.get(sessionId)
    if (!session || session.account !== account) return { kind: 'unknown', message: 'No such checkout.session' }
    if (session.status === 'open') session.status = 'expired'
    return session.status === 'complete'
      ? { kind: 'complete', session: this.view(session) }
      : { kind: 'expired', session: this.view(session) }
  }

  async latestChargeId(paymentIntentId: string): Promise<string | null> {
    return `ch_for_${paymentIntentId}`
  }

  /** The family pays on Stripe's page */
  pay(sessionId: string): GatewaySession {
    const session = this.sessions.get(sessionId)
    if (!session || session.status !== 'open') throw new Error(`checkout ${sessionId} is not open`)
    session.status = 'complete'
    session.paymentStatus = 'paid'
    session.paymentIntentId = `pi_${sessionId}`
    return this.view(session)
  }

  /** Stripe expires the session on its own */
  expire(sessionId: string): GatewaySession {
    const session = this.sessions.get(sessionId)
    if (!session || session.status !== 'open') throw new Error(`checkout ${sessionId} is not open`)
    session.status = 'expired'
    return this.view(session)
  }

  sessionsFor(registrationId: string): StoredSession[] {
    return [...this.sessions.values()].filter((s) => s.metadata.registration_id === registrationId)
  }

  private makeSession(config: CheckoutConfig): StoredSession {
    const id = this.sessionId(++this.counter)
    const session: StoredSession = {
      id, url: `https://checkout.stripe.test/${id}`, status: 'open', paymentStatus: 'unpaid',
      amountTotal: config.total_cents, currency: config.currency, paymentIntentId: null,
      metadata: { ...config.metadata }, account: config.account, created: this.now().getTime(),
    }
    this.sessions.set(id, session)
    return session
  }

  private failure(failure: StripeFailure, message: string): CreateSessionOutcome {
    return { kind: 'failed', failure, message }
  }

  private view(session: StoredSession): GatewaySession {
    return {
      id: session.id, url: session.url, status: session.status, paymentStatus: session.paymentStatus,
      amountTotal: session.amountTotal, currency: session.currency, paymentIntentId: session.paymentIntentId,
      metadata: { ...session.metadata },
    }
  }
}
