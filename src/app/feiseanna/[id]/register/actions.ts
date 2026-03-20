'use server'

import { createClient } from '@/lib/supabase/server'
import { canTransitionRegistration } from '@/lib/registration-states'
import type { RegistrationStatus } from '@/lib/types/feis-listing'

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

  const { data: reg, error: fetchError } = await supabase
    .from('registrations')
    .select('status')
    .eq('id', registrationId)
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
