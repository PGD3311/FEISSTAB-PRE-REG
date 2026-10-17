import type Stripe from 'stripe'
import type { OrderStore } from './order-store'
import { toGatewaySession, type StripeGateway } from './stripe-gateway'

export interface WebhookDeps {
  store: OrderStore
  stripe: StripeGateway
  log: (line: string) => void
}

export interface WebhookOutcome {
  status: 200 | 500
  registrationId: string | null
  body: Record<string, unknown>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function ok(registrationId: string | null, body: Record<string, unknown>): WebhookOutcome {
  return { status: 200, registrationId, body }
}

/** Maps a verified Stripe event to the database function that handles it (spec §8). */
export async function handleStripeEvent(
  deps: WebhookDeps,
  event: Stripe.Event
): Promise<WebhookOutcome> {
  if (!event.type.startsWith('checkout.session.')) return ok(null, { ignored: event.type })

  const session = event.data.object as Stripe.Checkout.Session
  const registrationId = session.metadata?.registration_id ?? null
  // Organisers' own Stripe sales reach this Connect endpoint too; they carry no RunFeis order
  if (!registrationId || !UUID.test(registrationId)) {
    return ok(null, { ignored: 'not a RunFeis checkout' })
  }

  const metadataClaim = session.metadata?.claim_id ?? null
  const claimId = metadataClaim && UUID.test(metadataClaim) ? metadataClaim : null
  const account = event.account ?? ''

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        if (session.payment_status !== 'paid') {
          deps.log(`[WEBHOOK] ${session.id} completed without payment yet; waiting`)
          return ok(registrationId, { waiting: true })
        }
        const paymentIntentId = toGatewaySession(session).paymentIntentId
        const chargeId = paymentIntentId
          ? await deps.stripe.latestChargeId(paymentIntentId, account)
          : null
        const result = await deps.store.confirmOrderPayment({
          registrationId,
          claimId,
          sessionId: session.id,
          account,
          amountCents: session.amount_total ?? null,
          currency: session.currency ?? null,
          paymentStatus: session.payment_status,
          paymentIntentId,
          chargeId,
          eventId: event.id,
          source: 'webhook'
        })
        if (result.result === 'exception') {
          const { support_ref: ref, reason } = result
          deps.log(`[PAYMENT_EXCEPTION] ${ref} ${reason} order ${registrationId}`)
        }
        return ok(registrationId, result)
      }

      case 'checkout.session.async_payment_failed': {
        const result = await deps.store.recordPaymentFailure({
          registrationId,
          claimId,
          sessionId: session.id,
          account,
          eventId: event.id
        })
        if (result.result === 'recorded') {
          const ref = result.support_ref
          deps.log(`[PAYMENT_EXCEPTION] ${ref} payment_failed order ${registrationId}`)
        } else {
          // It fails the order's checks, so it changes nothing; no money moved (spec §8)
          const why = 'no order with this claim, account and session'
          deps.log(`[WEBHOOK] payment failure of ${session.id} ignored: ${why}`)
        }
        return ok(registrationId, result)
      }

      case 'checkout.session.expired': {
        const result = await deps.store.expireCheckout({
          registrationId,
          claimId,
          sessionId: session.id,
          account
        })
        if (result.result === 'ignored') {
          deps.log(`[WEBHOOK] expiry of ${session.id} ignored: ${result.why}`)
        }
        return ok(registrationId, result)
      }

      default:
        return ok(registrationId, { ignored: event.type })
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    deps.log(`[WEBHOOK] database step failed for ${event.id}: ${reason}`)
    return { status: 500, registrationId, body: { error: 'database step failed' } }
  }
}
