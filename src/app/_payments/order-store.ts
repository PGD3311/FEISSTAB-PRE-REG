import type { CheckoutConfig } from '@/lib/engine/checkout-config'
import type { CreateOrderPayload, PurchaseSnapshot } from '@/lib/engine/purchase-snapshot'
import type { ListingStatus, RegistrationStatus } from '@/lib/types/feis-listing'
import type { RpcCaller } from './rpc'

export type CreateOrderResult =
  | { status: 'created'; registration_id: string; hold_expires_at: string }
  | {
      status: 'refused'
      reason: 'listing_closed' | 'outside_window' | 'active_order_exists'
      registration_id?: string
    }

/** An order as Pay, Cancel and the sync see it (get_order_for_checkout). */
export interface CheckoutOrder {
  id: string
  household_id: string
  feis_listing_id: string
  status: RegistrationStatus
  total_cents: number
  application_fee_cents: number
  event_fee_cents: number
  hold_expires_at: string | null
  confirmation_number: string | null
  checkout_claim_id: string | null
  checkout_config: CheckoutConfig | null
  checkout_claimed_at: string | null
  checkout_expires_at: string | null
  stripe_checkout_session_id: string | null
  purchase_snapshot: PurchaseSnapshot
  listing: { status: ListingStatus; stripe_account_id: string | null }
  competition_ids: string[]
  enabled_competition_ids: string[]
}

export function createOrderStore(rpc: RpcCaller) {
  return {
    async createOrder(
      householdId: string,
      feisListingId: string,
      payload: CreateOrderPayload
    ): Promise<CreateOrderResult> {
      return (await rpc('create_order', {
        p_household_id: householdId,
        p_feis_listing_id: feisListingId,
        p_order: payload
      })) as CreateOrderResult
    },

    async getOrderForCheckout(
      registrationId: string,
      householdId: string
    ): Promise<CheckoutOrder | null> {
      return (await rpc('get_order_for_checkout', {
        p_registration_id: registrationId,
        p_household_id: householdId
      })) as CheckoutOrder | null
    }
  }
}

export type OrderStore = ReturnType<typeof createOrderStore>
