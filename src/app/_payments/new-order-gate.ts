import { newOrderGate, type NewOrderGate, type PaymentReview } from '@/lib/payment-review-messages'
import type { createClient } from '@/lib/supabase/server'

type UserClient = Awaited<ReturnType<typeof createClient>>

/** What the gate reads. Each read throws if it fails: the gate then refuses (fails closed). */
export interface NewOrderReader {
  /** The feis an order is for, or null when the order isn't the signed-in family's */
  orderFeis(registrationId: string): Promise<string | null>
  /** The ids of the family's orders for a feis, whatever their status */
  familyOrderIds(feisListingId: string): Promise<string[]>
  /** The family's payment cases: get_my_payment_reviews() for all their orders */
  reviews(): Promise<PaymentReview[]>
}

/** What a new order or payment is for: a feis, or an order of the family's */
export type NewOrderTarget = { feisListingId: string } | { registrationId: string }

/**
 * Decision 13 on the server (spec §14): while the family has an open message-A case for a feis,
 * Submit and Pay refuse, even from an entry page opened before the case existed. It reads the
 * family's orders for the feis and its payment cases through `reader`, as the register page does,
 * and asks `newOrderGate`. A read that fails refuses (fails closed): the gate can't be judged, and
 * a second payment can't be undone. An order that isn't the family's is allowed here: Pay then
 * answers "not found" for it.
 */
export async function checkNewOrderGate(
  reader: NewOrderReader,
  order: NewOrderTarget
): Promise<NewOrderGate> {
  try {
    let feisListingId: string
    if ('feisListingId' in order) {
      feisListingId = order.feisListingId
    } else {
      const orderFeis = await reader.orderFeis(order.registrationId)
      if (orderFeis === null) return { allowed: true }
      feisListingId = orderFeis
    }
    const [registrationIds, reviews] = await Promise.all([
      reader.familyOrderIds(feisListingId),
      reader.reviews()
    ])
    return newOrderGate({ registrationIds, reviews })
  } catch (err) {
    console.error('Could not check for an open payment case:', err)
    return newOrderGate(null)
  }
}

/** The reader for a signed-in family: their own client, so it only ever sees their own rows */
export function userClientNewOrderReader(client: UserClient, householdId: string): NewOrderReader {
  return {
    async orderFeis(registrationId) {
      const { data, error } = await client
        .from('registrations')
        .select('feis_listing_id')
        .eq('id', registrationId)
        .eq('household_id', householdId)
        .maybeSingle()
      if (error) throw error
      return data?.feis_listing_id ?? null
    },
    async familyOrderIds(feisListingId) {
      const { data, error } = await client
        .from('registrations')
        .select('id')
        .eq('feis_listing_id', feisListingId)
        .eq('household_id', householdId)
      if (error) throw error
      return (data ?? []).map((row) => row.id)
    },
    async reviews() {
      const { data, error } = await client.rpc('get_my_payment_reviews', {
        p_registration_id: null
      })
      if (error) throw error
      return (data ?? []) as PaymentReview[]
    }
  }
}
