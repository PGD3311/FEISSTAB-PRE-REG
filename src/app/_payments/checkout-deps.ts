import { randomUUID } from 'node:crypto'
import { getStripe } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase/service'
import type { CheckoutDeps } from './checkout-workflow'
import { createOrderStore } from './order-store'
import { supabaseRpc } from './rpc'
import { createStripeGateway } from './stripe-gateway'

/** The real dependencies for Pay, Cancel and the confirmation sync */
export function checkoutDeps(): CheckoutDeps {
  return {
    store: createOrderStore(supabaseRpc(createServiceClient())),
    stripe: createStripeGateway(getStripe()),
    now: () => new Date(),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    baseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000',
    newClaimId: () => randomUUID()
  }
}
