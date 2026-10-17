'use server'

import { createClient } from '@/lib/supabase/server'
import { canTransitionRegistration } from '@/lib/registration-states'
import { calculateFees, summarisePaidOrders } from '@/lib/engine/fee-calculator'
import { isHouseholdComplete } from '@/lib/household'
import { generateConfirmationNumber } from '@/lib/confirmation-number'
import { createServiceClient } from '@/lib/supabase/service'
import type {
  RegistrationStatus,
  FeeSchedule,
  FeeEntry,
  FeeCategoryType
} from '@/lib/types/feis-listing'

export async function getExistingRegistration(feisListingId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: household } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!household) return { error: 'No household' }

  const { data: registration } = await supabase
    .from('registrations')
    .select('*, registration_entries(*)')
    .eq('feis_listing_id', feisListingId)
    .eq('household_id', household.id)
    .in('status', ['draft', 'pending_payment'])
    .single()

  if (!registration) return { registration: null }

  // Check if hold is expired
  if (registration.hold_expires_at && new Date(registration.hold_expires_at) < new Date()) {
    await supabase
      .from('registrations')
      .update({ status: 'expired' })
      .eq('id', registration.id)
    return { registration: null, expired: true }
  }

  return { registration }
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

interface CreateDraftInput {
  feisListingId: string
  entries: { dancerId: string; competitionId: string }[]
  consentAcceptedAt: string
  consentIp: string
}

export async function createDraftRegistration(input: CreateDraftInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: household } = await supabase
    .from('households')
    .select('id, first_name, last_name, phone, address_line1, city, state_region, postal_code')
    .eq('user_id', user.id)
    .single()

  if (!household) return { error: 'Household not found' }
  if (!isHouseholdComplete(household)) {
    return { error: 'Please add your family details (name, phone and address) before registering.' }
  }

  // Fetch fee schedule and listing in parallel (both use feisListingId)
  const [{ data: feeSchedule, error: feeError }, { data: listing }] = await Promise.all([
    supabase.from('fee_schedules').select('*').eq('feis_listing_id', input.feisListingId).single(),
    supabase
      .from('feis_listings')
      .select('reg_closes_at, late_reg_closes_at, stripe_account_id')
      .eq('id', input.feisListingId)
      .single(),
  ])

  if (feeError || !feeSchedule) return { error: 'Fee schedule not found' }
  if (!listing) return { error: 'Feis listing not found' }

  // Validate registration window is open
  const now = new Date()
  if (listing.reg_closes_at) {
    const regCloses = new Date(listing.reg_closes_at)
    if (listing.late_reg_closes_at) {
      const lateCloses = new Date(listing.late_reg_closes_at)
      if (now > lateCloses) {
        return { error: 'Registration for this feis has closed.' }
      }
    } else if (now > regCloses) {
      return { error: 'Registration for this feis has closed.' }
    }
  }

  // Validate dancers and competitions in parallel
  const dancerIds = [...new Set(input.entries.map(e => e.dancerId))]
  const compIds = [...new Set(input.entries.map(e => e.competitionId))]

  const [{ data: validDancers }, { data: competitions }] = await Promise.all([
    supabase.from('dancers').select('id').eq('household_id', household.id).in('id', dancerIds),
    supabase
      .from('feis_competitions')
      .select('id, fee_category, fee_cents, exclude_from_family_cap')
      .eq('feis_listing_id', input.feisListingId)
      .eq('enabled', true)
      .in('id', compIds),
  ])

  if (!validDancers || validDancers.length !== dancerIds.length) {
    return { error: 'One or more dancers do not belong to your family.' }
  }

  if (!competitions || competitions.length !== compIds.length) {
    return { error: 'One or more competitions are not available.' }
  }

  const compMap = new Map(competitions.map(c => [c.id, c]))

  // Orders the family already paid for this feis: new entries are added on top of them
  const { data: paidOrders, error: paidError } = await supabase
    .from('registrations')
    .select(
      'event_fee_cents, registration_entries(dancer_id, feis_competition_id, base_fee_cents, late_fee_cents, feis_competitions(exclude_from_family_cap))'
    )
    .eq('feis_listing_id', input.feisListingId)
    .eq('household_id', household.id)
    .eq('status', 'paid')

  if (paidError) {
    console.error('Failed to load paid orders:', paidError)
    return { error: 'Your entries could not be checked. Try again.' }
  }

  // TODO: type when Supabase types generated
  const paidEntries = (paidOrders ?? []).flatMap(o => o.registration_entries as unknown as {
    dancer_id: string
    feis_competition_id: string
    base_fee_cents: number
    late_fee_cents: number
    feis_competitions: { exclude_from_family_cap: boolean } | null
  }[])
  const alreadyEntered = new Set(paidEntries.map(e => `${e.dancer_id}|${e.feis_competition_id}`))
  if (input.entries.length === 0) return { error: 'Choose at least one dance.' }
  if (input.entries.some(e => alreadyEntered.has(`${e.dancerId}|${e.competitionId}`))) {
    return { error: 'One of these dances is already entered and paid for. Refresh the page.' }
  }
  const prior = summarisePaidOrders(
    paidOrders ?? [],
    paidEntries,
    new Set(
      paidEntries
        .filter(e => e.feis_competitions?.exclude_from_family_cap)
        .map(e => e.feis_competition_id)
    )
  )

  const feeEntries: FeeEntry[] = input.entries.map(e => {
    const comp = compMap.get(e.competitionId)
    return {
      dancer_id: e.dancerId,
      fee_category: (comp?.fee_category ?? 'solo') as FeeCategoryType,
      fee_cents_override: comp?.fee_cents ?? null,
      exclude_from_family_cap: comp?.exclude_from_family_cap ?? false,
      is_day_of: false
    }
  })

  const breakdown = calculateFees(feeSchedule as FeeSchedule, feeEntries, now, prior)
  const isLate = breakdown.active_late_tier !== null

  const holdExpiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString()

  const { data: reg, error: regError } = await supabase
    .from('registrations')
    .insert({
      feis_listing_id: input.feisListingId,
      household_id: household.id,
      status: 'draft',
      total_cents: breakdown.grand_total_cents,
      application_fee_cents: Math.round(
        breakdown.grand_total_cents * (parseInt(process.env.STRIPE_APPLICATION_FEE_PERCENT ?? '5', 10) / 100)
      ),
      event_fee_cents: breakdown.event_fee_cents,
      is_late: isLate,
      consent_accepted_at: input.consentAcceptedAt,
      consent_version: 'tos-v1-2026-03-01',
      platform_terms_version: 'platform-v1-2026-03-01',
      consent_ip: input.consentIp,
      hold_expires_at: holdExpiresAt
    })
    .select('id')
    .single()

  if (regError || !reg) {
    console.error('Failed to create registration:', regError)
    return { error: 'Failed to create registration. You may already have an active registration for this feis.' }
  }

  // Line items come back in the same order as input.entries
  const entryRows = input.entries.map((e, i) => {
    const item = breakdown.line_items[i]
    return {
      registration_id: reg.id,
      dancer_id: e.dancerId,
      feis_competition_id: e.competitionId,
      fee_category: feeEntries[i].fee_category,
      base_fee_cents: item.base_fee_cents,
      late_fee_cents: item.late_fee_cents,
      day_of_surcharge_cents: item.day_of_surcharge_cents
    }
  })

  const { error: entriesError } = await supabase
    .from('registration_entries')
    .insert(entryRows)

  if (entriesError) {
    console.error('Failed to create entries:', entriesError)
    await supabase.from('registrations').delete().eq('id', reg.id)
    return { error: 'Failed to create registration entries' }
  }

  return {
    registrationId: reg.id,
    totalCents: breakdown.grand_total_cents,
    holdExpiresAt
  }
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
    .select('*, registration_entries(*, dancers(first_name, last_name)), feis_listings(name, stripe_account_id)')
    .eq('id', registrationId)
    .eq('household_id', household.id)
    .single()

  if (regError || !reg) return { error: 'Registration not found' }
  if (reg.status !== 'draft') return { error: `Cannot create checkout for ${reg.status} registration` }

  if (reg.hold_expires_at && new Date(reg.hold_expires_at) < new Date()) {
    await supabase.from('registrations').update({ status: 'expired' }).eq('id', registrationId)
    return { error: 'Registration hold has expired. Please start over.' }
  }

  // Added dances that cost nothing (the family max is already reached) need no card payment
  if (reg.total_cents === 0) return confirmFreeOrder(registrationId, reg.feis_listing_id)

  const connectedAccountId = reg.feis_listings?.stripe_account_id
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

/**
 * Confirms an order with nothing to pay, as the Stripe webhook does for a paid one: marks it
 * paid, gives new dancers their numbers and sends the confirmation email. Runs with the
 * service role because parents can't mark their own orders paid.
 */
async function confirmFreeOrder(registrationId: string, feisListingId: string) {
  const service = createServiceClient()
  for (const next of ['pending_payment', 'paid'] as RegistrationStatus[]) {
    const { data: current, error: readError } = await service
      .from('registrations')
      .select('status')
      .eq('id', registrationId)
      .single()
    if (readError || !current) return { error: 'Registration not found' }
    if (!canTransitionRegistration(current.status as RegistrationStatus, next)) {
      return { error: `Cannot move a ${current.status} registration to ${next}` }
    }
    const { error } = await service
      .from('registrations')
      .update(
        next === 'paid'
          ? {
              status: 'paid',
              paid_at: new Date().toISOString(),
              hold_expires_at: null,
              confirmation_number: generateConfirmationNumber()
            }
          : { status: next }
      )
      .eq('id', registrationId)
      .eq('status', current.status)
    if (error) {
      console.error('Failed to confirm free order:', error)
      return { error: 'Your entries could not be confirmed. Try again.' }
    }
  }

  const { error: numbersError } = await service.rpc('assign_competitor_numbers', {
    p_registration_id: registrationId
  })
  if (numbersError) console.error('Failed to assign numbers for free order:', numbersError)

  try {
    const { sendConfirmationEmail } = await import('@/lib/email/send-confirmation')
    await sendConfirmationEmail(registrationId, service)
  } catch (err) {
    console.error('Failed to send confirmation email for free order:', err)
  }

  return { url: `/feiseanna/${feisListingId}/register/success` }
}
