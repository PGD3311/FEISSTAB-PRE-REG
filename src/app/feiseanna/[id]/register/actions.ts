'use server'

import { headers } from 'next/headers'
import { createClient, getSignedInUser } from '@/lib/supabase/server'
import { createServiceClient, type ServiceClient } from '@/lib/supabase/service'
import { canTransitionRegistration } from '@/lib/registration-states'
import { clientIpFrom } from '@/lib/engine/consent'
import {
  validateOrderRequest,
  type OrderDancer,
  type RequestedEntry
} from '@/lib/engine/order-validation'
import {
  buildCreateOrderPayload,
  priceOrder,
  type CreateOrderPayload
} from '@/lib/engine/purchase-snapshot'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { isHouseholdComplete, REQUIRED_HOUSEHOLD_FIELDS } from '@/lib/household'
import { REGISTRATION_COLUMNS } from '@/lib/registration-columns'
import { createOrderStore, type CreateOrderResult } from '@/app/_payments/order-store'
import { supabaseRpc } from '@/app/_payments/rpc'
import type {
  FeeBreakdown,
  FeeSchedule,
  FeisCompetition,
  FeisListing,
  Household,
  Registration,
  RegistrationEntry,
  RegistrationStatus
} from '@/lib/types/feis-listing'

type RefusalReason = Extract<CreateOrderResult, { status: 'refused' }>['reason']

/** What a family is told when create_order refuses after the checks here have passed */
const REFUSAL_MESSAGES: Record<RefusalReason, string> = {
  listing_closed: 'Registration for this feis is not open.',
  outside_window: 'Registration for this feis has closed.',
  active_order_exists: 'You already have entries for this feis. Reload this page to see them.'
}

type HouseholdContext =
  | { error: string }
  | {
      supabase: Awaited<ReturnType<typeof createClient>>
      household: Pick<Household, 'id' | (typeof REQUIRED_HOUSEHOLD_FIELDS)[number]>
    }

/**
 * The signed-in parent's household, read with their own client: this is what proves an order
 * is theirs (spec §4, §6, §7).
 */
async function currentHousehold(): Promise<HouseholdContext> {
  const supabase = await createClient()
  const user = await getSignedInUser(supabase)
  if (!user) return { error: 'Please sign in again to continue.' }

  const { data: household, error } = await supabase
    .from('households')
    .select('id, first_name, last_name, phone, address_line1, city, state_region, postal_code')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) return { error: 'Your family details could not be loaded. Please try again.' }
  if (!household) return { error: 'Please finish setting up your family account first.' }
  return { supabase, household }
}

/**
 * The family's unpaid order for this feis while it still holds its places. Read-only: a hold
 * that has passed already counts as expired here, and the expiry job makes the change (spec §13).
 */
export async function getExistingRegistration(feisListingId: string): Promise<
  | { error: string }
  | {
      registration: (Registration & { registration_entries: RegistrationEntry[] }) | null
      expired?: true
    }
> {
  const ctx = await currentHousehold()
  if ('error' in ctx) return { error: ctx.error }

  const { data: registration, error } = await ctx.supabase
    .from('registrations')
    .select(`${REGISTRATION_COLUMNS}, registration_entries(*)`)
    .eq('feis_listing_id', feisListingId)
    .eq('household_id', ctx.household.id)
    .in('status', ['draft', 'pending_payment'])
    .maybeSingle()
  if (error) return { error: 'Your entries could not be loaded. Please try again.' }
  if (!registration) return { registration: null }

  if (registration.hold_expires_at && new Date(registration.hold_expires_at) <= new Date()) {
    return { registration: null, expired: true }
  }
  return {
    registration: registration as Registration & { registration_entries: RegistrationEntry[] }
  }
}

/** What Submit checks and prices an order against, read fresh with the service role */
async function loadOrderInputs(service: ServiceClient, feisListingId: string, householdId: string) {
  const [listing, feeSchedule, dancers, competitions] = await Promise.all([
    service.from('feis_listings').select('*').eq('id', feisListingId).maybeSingle(),
    service.from('fee_schedules').select('*').eq('feis_listing_id', feisListingId).maybeSingle(),
    service
      .from('dancers')
      .select('*, dance_levels:dancer_dance_levels(dance_key, level_key)')
      .eq('household_id', householdId),
    // Every competition of this feis, enabled or not, since eligibility is judged against the
    // whole list. Read in pages: PostgREST returns at most 1000 rows per request.
    fetchAllRows<FeisCompetition>((from, to) =>
      service
        .from('feis_competitions')
        .select('*', { count: 'exact' })
        .eq('feis_listing_id', feisListingId)
        .order('id', { ascending: true })
        .range(from, to)
    )
  ])
  const failed = listing.error ?? feeSchedule.error ?? dancers.error
  if (failed) throw new Error(failed.message)
  return {
    listing: listing.data as FeisListing | null,
    feeSchedule: feeSchedule.data as FeeSchedule | null,
    dancers: (dancers.data ?? []) as OrderDancer[],
    competitions
  }
}

interface CreateDraftInput {
  feisListingId: string
  entries: RequestedEntry[]
  /** The family ticked the agreement. The server records when, and from which address. */
  consentAccepted: boolean
}

/** Submit (spec §4): check, price and create the order on the server, in one database step */
export async function createDraftRegistration(
  input: CreateDraftInput
): Promise<
  | { error: string }
  | { registrationId: string; totalCents: number; holdExpiresAt: string; breakdown: FeeBreakdown }
> {
  if (input.consentAccepted !== true) return { error: 'Please accept the terms to continue.' }

  const ctx = await currentHousehold()
  if ('error' in ctx) return { error: ctx.error }
  if (!isHouseholdComplete(ctx.household)) {
    return { error: 'Please add your family details (name, phone and address) before registering.' }
  }

  const service = createServiceClient()
  const loaded = await loadOrderInputs(service, input.feisListingId, ctx.household.id).catch(
    (err: unknown) => {
      console.error('Submit could not load the feis:', err)
      return null
    }
  )
  if (!loaded) return { error: 'The feis details could not be loaded. Please try again.' }
  const { listing, feeSchedule, dancers, competitions } = loaded
  if (!listing) return { error: 'This feis could not be found.' }
  if (!feeSchedule) return { error: "This feis hasn't set its fees yet, so entries can't be paid." }

  const now = new Date()
  const levels = listing.syllabus_snapshot?.levels ?? []
  const validation = validateOrderRequest({
    now,
    householdId: ctx.household.id,
    listing: { ...listing, levels },
    dancers,
    competitions,
    entries: input.entries
  })
  if (!validation.ok) return { error: validation.error }

  let payload: CreateOrderPayload
  let breakdown: FeeBreakdown
  try {
    const priced = priceOrder({
      now,
      ageCutoffDate: validation.ageCutoffDate,
      levels,
      feisTermsUrl: listing.terms_url,
      dancers,
      competitions,
      entries: input.entries,
      feeSchedule
    })
    payload = buildCreateOrderPayload(priced, {
      // parseFloat keeps a fractional percent. Missing, it parses as NaN, which the engine refuses
      // like any value outside 0 to 100, so Submit stops instead of pricing wrongly (spec §4)
      applicationFeePercent: Number.parseFloat(process.env.STRIPE_APPLICATION_FEE_PERCENT ?? ''),
      consentIp: clientIpFrom(await headers())
    })
    breakdown = priced.breakdown
  } catch (err) {
    console.error('Submit could not price the order:', err)
    return { error: 'Your entries could not be priced. Please try again later.' }
  }

  try {
    const result = await createOrderStore(supabaseRpc(service)).createOrder(
      ctx.household.id,
      input.feisListingId,
      payload
    )
    if (result.status === 'refused') return { error: REFUSAL_MESSAGES[result.reason] }
    return {
      registrationId: result.registration_id,
      totalCents: payload.total_cents,
      holdExpiresAt: result.hold_expires_at,
      breakdown
    }
  } catch (err) {
    console.error('create_order failed:', err)
    return { error: 'Your entries could not be saved. Please try again.' }
  }
}

export async function cancelRegistration(registrationId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: household } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (!household) return { error: 'Household not found' }

  const { data: reg, error: fetchError } = await supabase
    .from('registrations')
    .select('status')
    .eq('id', registrationId)
    .eq('household_id', household.id)
    .single()

  if (fetchError || !reg) return { error: 'Registration not found' }

  const currentStatus = reg.status as RegistrationStatus
  if (!canTransitionRegistration(currentStatus, 'cancelled')) {
    return { error: `Cannot cancel registration in ${currentStatus} state` }
  }

  const { error } = await supabase
    .from('registrations')
    .update({ status: 'cancelled' })
    .eq('id', registrationId)

  if (error) {
    console.error('Failed to cancel registration:', error)
    return { error: 'Failed to cancel registration' }
  }

  return { success: true as const }
}

export async function createCheckoutSession(registrationId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: household } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (!household) return { error: 'Household not found' }

  const { data: reg, error: regError } = await supabase
    .from('registrations')
    .select(
      `${REGISTRATION_COLUMNS}, registration_entries(*, dancers(first_name, last_name)), feis_listings(name, stripe_account_id)`
    )
    .eq('id', registrationId)
    .eq('household_id', household.id)
    .single()

  if (regError || !reg) return { error: 'Registration not found' }
  if (reg.status !== 'draft') return { error: `Cannot create checkout for ${reg.status} registration` }

  if (reg.hold_expires_at && new Date(reg.hold_expires_at) < new Date()) {
    await supabase.from('registrations').update({ status: 'expired' }).eq('id', registrationId)
    return { error: 'Registration hold has expired. Please start over.' }
  }

  // The client types a to-one embed as an array, but a registration has one feis
  const feisListing = reg.feis_listings as unknown as { stripe_account_id: string | null } | null
  const connectedAccountId = feisListing?.stripe_account_id
  if (!connectedAccountId) {
    return { error: 'Organiser has not connected Stripe' }
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'

  try {
    const stripe = (await import('@/lib/stripe')).getStripe()

    const lineItems = reg.registration_entries.map((entry: Record<string, unknown>) => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: `${(entry.dancers as Record<string, string>)?.first_name ?? 'Dancer'} — Competition Entry`
        },
        unit_amount:
          (entry.base_fee_cents as number) +
          (entry.late_fee_cents as number) +
          (entry.day_of_surcharge_cents as number)
      },
      quantity: 1
    }))

    if (reg.event_fee_cents > 0) {
      lineItems.unshift({
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Event Fee (per family)'
          },
          unit_amount: reg.event_fee_cents
        },
        quantity: 1
      })
    }

    // Stripe has no negative line items, so when the family max brings the total down
    // the whole registration is charged as one line at the capped total
    const itemsTotal = lineItems.reduce(
      (sum: number, li: { price_data: { unit_amount: number } }) => sum + li.price_data.unit_amount,
      0
    )
    if (itemsTotal !== reg.total_cents) {
      lineItems.splice(0, lineItems.length, {
        price_data: {
          currency: 'usd',
          product_data: { name: 'Feis entries (family maximum applied)' },
          unit_amount: reg.total_cents
        },
        quantity: 1
      })
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: lineItems,
        payment_intent_data: {
          application_fee_amount: reg.application_fee_cents
        },
        success_url: `${baseUrl}/feiseanna/${reg.feis_listing_id}/register/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/feiseanna/${reg.feis_listing_id}/register?step=3`,
        metadata: {
          registration_id: registrationId
        },
        expires_at: Math.floor(Date.now() / 1000) + 1800
      },
      {
        stripeAccount: connectedAccountId,
        idempotencyKey: `checkout_${registrationId}`
      }
    )

    const { error: updateError } = await supabase
      .from('registrations')
      .update({
        status: 'pending_payment',
        stripe_checkout_session_id: session.id
      })
      .eq('id', registrationId)

    if (updateError) {
      console.error('Failed to update registration status:', updateError)
      return { error: 'Failed to update registration status' }
    }

    return { url: session.url }
  } catch (err) {
    console.error('Stripe checkout error:', err)
    return { error: 'Failed to create checkout session' }
  }
}
