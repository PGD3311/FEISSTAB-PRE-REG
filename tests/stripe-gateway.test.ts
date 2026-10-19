import type Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import { createStripeGateway } from '@/app/_payments/stripe-gateway'
import type { CheckoutConfig } from '@/lib/engine/checkout-config'

const config: CheckoutConfig = {
  version: 1,
  account: 'acct_test_feis',
  currency: 'usd',
  total_cents: 4000,
  application_fee_cents: 200,
  line_items: [{ name: 'Event fee (per family)', amount_cents: 4000 }],
  success_url: 'https://runfeis.test/success',
  cancel_url: 'https://runfeis.test/cancel',
  expires_at: 1_800_000_000,
  payment_method_types: ['card'],
  client_reference_id: 'reg-1',
  metadata: { registration_id: 'reg-1', claim_id: 'claim-1' },
  idempotency_key: 'checkout:reg-1:claim-1'
}

describe('stripe gateway', () => {
  it('sends a create request once, with a short timeout, so Pay alone decides about replays', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'cs_test_1',
      url: 'https://checkout.stripe.test/cs_test_1',
      status: 'open',
      payment_status: 'unpaid',
      metadata: { registration_id: 'reg-1', claim_id: 'claim-1' }
    })
    const stripe = { checkout: { sessions: { create } } } as unknown as Stripe

    const outcome = await createStripeGateway(stripe).createCheckoutSession(config)

    expect(outcome.kind).toBe('created')
    expect(create).toHaveBeenCalledTimes(1)
    // The SDK would otherwise retry on its own for up to 80 seconds a try, past the 5-minute deadline
    expect(create.mock.calls[0][1]).toEqual({
      stripeAccount: 'acct_test_feis',
      idempotencyKey: 'checkout:reg-1:claim-1',
      maxNetworkRetries: 0,
      timeout: 20_000
    })
  })

  describe("RunFeis's flat fee on the request", () => {
    /** The one create request this gateway sent to a Stripe that accepts it */
    async function requestFor(
      checkout: CheckoutConfig
    ): Promise<Stripe.Checkout.SessionCreateParams> {
      const create = vi.fn().mockResolvedValue({
        id: 'cs_test_1',
        url: null,
        status: 'open',
        payment_status: 'unpaid',
        metadata: checkout.metadata
      })
      const stripe = { checkout: { sessions: { create } } } as unknown as Stripe
      const outcome = await createStripeGateway(stripe).createCheckoutSession(checkout)
      expect(outcome.kind).toBe('created')
      return create.mock.calls[0][0]
    }

    it('sends the application fee when the order carries one', async () => {
      const request = await requestFor({ ...config, application_fee_cents: 600 })
      expect(request.payment_intent_data).toEqual({ application_fee_amount: 600 })
    })

    it('leaves the application fee out of the request when the order carries none', async () => {
      const request = await requestFor({ ...config, application_fee_cents: 0 })
      expect(request.payment_intent_data?.application_fee_amount).toBeUndefined()
      expect(Object.keys(request.payment_intent_data ?? {})).not.toContain('application_fee_amount')
      expect(JSON.stringify(request)).not.toContain('application_fee')
    })

    it('still sends everything else for an order with no fee', async () => {
      const withFee = await requestFor(config)
      const without = await requestFor({ ...config, application_fee_cents: 0 })
      expect(without).toEqual({ ...withFee, payment_intent_data: undefined })
    })
  })
})
