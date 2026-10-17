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
})
