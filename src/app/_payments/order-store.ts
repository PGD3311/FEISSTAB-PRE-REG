import type { CheckoutConfig } from '@/lib/engine/checkout-config'
import type { CheckoutBlock } from '@/lib/engine/checkout-policy'
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

export type ClaimResult =
  | {
      result: 'claimed' | 'already_claimed'
      status: RegistrationStatus
      claim_id: string
      config: CheckoutConfig
      claimed_at: string
      session_id: string | null
    }
  | { result: 'blocked'; reason: CheckoutBlock }
  | { result: 'not_claimable'; status: RegistrationStatus; hold_expired: boolean }
  | { result: 'not_found' }

export type AttachResult =
  | { result: 'attached' | 'already_attached' | 'claim_mismatch'; status: RegistrationStatus }
  | { result: 'not_attachable'; status: RegistrationStatus; session_id: string | null }
  | { result: 'not_found' }

export type CancelOrderResult =
  | { result: 'cancelled'; status: 'cancelled' }
  | { result: 'not_cancellable'; status: RegistrationStatus; claim_id: string | null }
  | { result: 'not_found' }

export type ExpireCheckoutResult =
  | { result: 'expired'; status: 'expired' }
  | { result: 'ignored'; why: 'not_found' | 'mismatch' | 'not_open'; status?: RegistrationStatus }

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
    },

    async claimCheckout(input: {
      registrationId: string
      householdId: string
      claimId: string
      config: CheckoutConfig
    }): Promise<ClaimResult> {
      return (await rpc('claim_checkout', {
        p_registration_id: input.registrationId,
        p_household_id: input.householdId,
        p_claim_id: input.claimId,
        p_config: input.config
      })) as ClaimResult
    },

    async attachCheckoutSession(
      registrationId: string,
      claimId: string,
      sessionId: string
    ): Promise<AttachResult> {
      return (await rpc('attach_checkout_session', {
        p_registration_id: registrationId,
        p_claim_id: claimId,
        p_session_id: sessionId
      })) as AttachResult
    },

    async cancelOrder(
      registrationId: string,
      householdId: string,
      expectedClaimId: string | null
    ): Promise<CancelOrderResult> {
      return (await rpc('cancel_order', {
        p_registration_id: registrationId,
        p_household_id: householdId,
        p_expected_claim_id: expectedClaimId
      })) as CancelOrderResult
    },

    async expireCheckout(input: {
      registrationId: string
      claimId: string | null
      sessionId: string
      account: string
    }): Promise<ExpireCheckoutResult> {
      return (await rpc('expire_checkout', {
        p_registration_id: input.registrationId,
        p_claim_id: input.claimId,
        p_session_id: input.sessionId,
        p_account: input.account
      })) as ExpireCheckoutResult
    }
  }
}

export type OrderStore = ReturnType<typeof createOrderStore>
