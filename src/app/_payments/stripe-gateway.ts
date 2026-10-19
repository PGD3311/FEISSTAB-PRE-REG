import type Stripe from 'stripe'
import type { CheckoutConfig } from '@/lib/engine/checkout-config'
import { classifyStripeError, type StripeFailure } from '@/lib/engine/stripe-errors'

export interface GatewaySession {
  id: string
  url: string | null
  status: 'open' | 'complete' | 'expired'
  paymentStatus: 'paid' | 'unpaid' | 'no_payment_required'
  amountTotal: number | null
  currency: string | null
  paymentIntentId: string | null
  metadata: Record<string, string>
}

export type CreateSessionOutcome =
  | { kind: 'created'; session: GatewaySession }
  | { kind: 'failed'; failure: StripeFailure; message: string }

/** What Stripe says the session is after an attempt to expire it. Read back, never assumed. */
export type ExpireSessionOutcome =
  | { kind: 'expired'; session: GatewaySession }
  | { kind: 'complete'; session: GatewaySession }
  | { kind: 'unknown'; message: string }

export interface StripeGateway {
  /** Sends exactly the frozen request, with its idempotency key, on its bound account */
  createCheckoutSession(config: CheckoutConfig): Promise<CreateSessionOutcome>
  /** null when Stripe couldn't be reached */
  retrieveCheckoutSession(sessionId: string, account: string): Promise<GatewaySession | null>
  /** The account's sessions created in the window whose metadata names this claim; null if Stripe couldn't be reached */
  listClaimSessions(account: string, claimId: string, createdFrom: Date, createdTo: Date): Promise<GatewaySession[] | null>
  expireCheckoutSession(sessionId: string, account: string): Promise<ExpireSessionOutcome>
  latestChargeId(paymentIntentId: string, account: string): Promise<string | null>
}

export function toGatewaySession(session: Stripe.Checkout.Session): GatewaySession {
  const paymentIntent = session.payment_intent
  return {
    id: session.id,
    url: session.url ?? null,
    status: session.status ?? 'open',
    paymentStatus: session.payment_status,
    amountTotal: session.amount_total ?? null,
    currency: session.currency ?? null,
    paymentIntentId: typeof paymentIntent === 'string' ? paymentIntent : (paymentIntent?.id ?? null),
    metadata: (session.metadata ?? {}) as Record<string, string>
  }
}

export function checkoutSessionParams(config: CheckoutConfig): Stripe.Checkout.SessionCreateParams {
  return {
    mode: 'payment',
    line_items: config.line_items.map((item) => ({
      price_data: {
        currency: config.currency,
        product_data: { name: item.name },
        unit_amount: item.amount_cents
      },
      quantity: 1
    })),
    payment_method_types: [...config.payment_method_types],
    // RunFeis's flat fee rides on the first paid order only. An add-on carries 0, and the request
    // leaves the fee out then (the config and the database still say 0); we haven't verified that
    // Stripe accepts an application_fee_amount of 0
    ...(config.application_fee_cents > 0
      ? { payment_intent_data: { application_fee_amount: config.application_fee_cents } }
      : {}),
    success_url: config.success_url,
    cancel_url: config.cancel_url,
    expires_at: config.expires_at,
    client_reference_id: config.client_reference_id,
    // Built field by field, so a config read back from the database (jsonb reorders keys)
    // produces exactly the same request as the one first sent
    metadata: { registration_id: config.metadata.registration_id, claim_id: config.metadata.claim_id }
  }
}

/** How long one create request may take before the workflow treats it as a retryable failure */
const CREATE_REQUEST_TIMEOUT_MS = 20_000

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function createStripeGateway(stripe: Stripe): StripeGateway {
  async function retrieveCheckoutSession(sessionId: string, account: string): Promise<GatewaySession | null> {
    try {
      return toGatewaySession(await stripe.checkout.sessions.retrieve(sessionId, {}, { stripeAccount: account }))
    } catch {
      return null
    }
  }

  return {
    async createCheckoutSession(config) {
      try {
        // One HTTP request per call, and a short one. The SDK would otherwise retry on its own
        // (2 retries, 80 seconds a try), sending create requests long after Pay's 5-minute
        // deadline. The workflow replays with the same idempotency key, and decides when to stop.
        const session = await stripe.checkout.sessions.create(checkoutSessionParams(config), {
          stripeAccount: config.account,
          idempotencyKey: config.idempotency_key,
          maxNetworkRetries: 0,
          timeout: CREATE_REQUEST_TIMEOUT_MS
        })
        return { kind: 'created', session: toGatewaySession(session) }
      } catch (err) {
        return { kind: 'failed', failure: classifyStripeError(err), message: message(err) }
      }
    },

    retrieveCheckoutSession,

    async listClaimSessions(account, claimId, createdFrom, createdTo) {
      try {
        const found: GatewaySession[] = []
        const sessions = stripe.checkout.sessions.list(
          {
            created: { gte: Math.floor(createdFrom.getTime() / 1000), lte: Math.ceil(createdTo.getTime() / 1000) },
            limit: 100
          },
          { stripeAccount: account }
        )
        for await (const session of sessions) {
          if (session.metadata?.claim_id === claimId) found.push(toGatewaySession(session))
        }
        return found
      } catch {
        return null
      }
    },

    async expireCheckoutSession(sessionId, account) {
      let failure = ''
      try {
        await stripe.checkout.sessions.expire(sessionId, {}, { stripeAccount: account })
      } catch (err) {
        // Stripe refuses for a session that is complete or already expired. Inspect it either way.
        failure = message(err)
      }
      const current = await retrieveCheckoutSession(sessionId, account)
      if (current?.status === 'expired') return { kind: 'expired', session: current }
      if (current?.status === 'complete') return { kind: 'complete', session: current }
      return {
        kind: 'unknown',
        message: current ? `checkout is still ${current.status}` : failure || 'Stripe could not be reached'
      }
    },

    async latestChargeId(paymentIntentId, account) {
      try {
        const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {}, { stripeAccount: account })
        const charge = intent.latest_charge
        return typeof charge === 'string' ? charge : (charge?.id ?? null)
      } catch {
        return null
      }
    }
  }
}
