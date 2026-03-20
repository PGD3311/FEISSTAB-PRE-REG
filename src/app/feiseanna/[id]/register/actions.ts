'use server'

import { createClient } from '@/lib/supabase/server'
import { canTransitionRegistration } from '@/lib/registration-states'
import { calculateFees } from '@/lib/engine/fee-calculator'
import type { RegistrationStatus, FeeSchedule, FeeEntry } from '@/lib/types/feis-listing'

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
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!household) return { error: 'Household not found' }

  const { data: feeSchedule, error: feeError } = await supabase
    .from('fee_schedules')
    .select('*')
    .eq('feis_listing_id', input.feisListingId)
    .single()

  if (feeError || !feeSchedule) return { error: 'Fee schedule not found' }

  const { data: listing } = await supabase
    .from('feis_listings')
    .select('reg_closes_at, late_reg_closes_at, stripe_account_id')
    .eq('id', input.feisListingId)
    .single()

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

  // Validate all dancers belong to this household
  const dancerIds = [...new Set(input.entries.map(e => e.dancerId))]
  const { data: validDancers } = await supabase
    .from('dancers')
    .select('id')
    .eq('household_id', household.id)
    .in('id', dancerIds)

  if (!validDancers || validDancers.length !== dancerIds.length) {
    return { error: 'One or more dancers do not belong to your family.' }
  }

  // Validate all competitions belong to this feis and are enabled
  const compIds = [...new Set(input.entries.map(e => e.competitionId))]
  const { data: validComps } = await supabase
    .from('feis_competitions')
    .select('id')
    .eq('feis_listing_id', input.feisListingId)
    .eq('enabled', true)
    .in('id', compIds)

  if (!validComps || validComps.length !== compIds.length) {
    return { error: 'One or more competitions are not available.' }
  }

  const isLate = listing.reg_closes_at ? now > new Date(listing.reg_closes_at) : false

  const { data: competitions } = await supabase
    .from('feis_competitions')
    .select('id, fee_category')
    .in('id', compIds)

  if (!competitions) return { error: 'Competitions not found' }

  const compMap = new Map(competitions.map(c => [c.id, c]))

  const feeEntries: FeeEntry[] = input.entries.map(e => {
    const comp = compMap.get(e.competitionId)
    return {
      dancer_id: e.dancerId,
      fee_category: (comp?.fee_category ?? 'solo') as 'solo' | 'prelim_champ' | 'open_champ',
      is_late: isLate,
      is_day_of: false
    }
  })

  const breakdown = calculateFees(feeSchedule as FeeSchedule, feeEntries)

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

  const lateCharged = new Set<string>()
  const entryRows = input.entries.map(e => {
    const comp = compMap.get(e.competitionId)
    const feeCategory = (comp?.fee_category ?? 'solo') as 'solo' | 'prelim_champ' | 'open_champ'
    const baseFee = feeCategory === 'prelim_champ'
      ? feeSchedule.prelim_champ_fee_cents
      : feeCategory === 'open_champ'
        ? feeSchedule.open_champ_fee_cents
        : feeSchedule.solo_fee_cents

    let lateFee = 0
    if (isLate && !lateCharged.has(e.dancerId)) {
      lateFee = feeSchedule.late_fee_cents
      lateCharged.add(e.dancerId)
    }

    return {
      registration_id: reg.id,
      dancer_id: e.dancerId,
      feis_competition_id: e.competitionId,
      fee_category: feeCategory,
      base_fee_cents: baseFee,
      late_fee_cents: lateFee,
      day_of_surcharge_cents: 0
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
