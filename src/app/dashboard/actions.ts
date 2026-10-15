'use server'

import { createClient } from '@/lib/supabase/server'
import { REQUIRED_HOUSEHOLD_FIELDS } from '@/lib/household'

export async function createHousehold() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  // Check if household already exists
  const { data: existing } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (existing) {
    return { id: existing.id }
  }

  const { data, error } = await supabase
    .from('households')
    .insert({ user_id: user.id })
    .select('id')
    .single()

  if (error) {
    console.error('Failed to create household:', error)
    return { error: 'Failed to create household' }
  }

  return { id: data.id }
}

const HOUSEHOLD_TEXT_FIELDS = [
  'first_name',
  'last_name',
  'phone',
  'address_line1',
  'address_line2',
  'city',
  'state_region',
  'postal_code',
  'country',
] as const

export async function saveHouseholdDetails(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const values: Record<string, string | null> = {}
  for (const field of HOUSEHOLD_TEXT_FIELDS) {
    const raw = ((formData.get(field) as string | null) ?? '').trim()
    values[field] = raw === '' ? null : raw
  }
  values.country = values.country ?? 'US'

  const missing = REQUIRED_HOUSEHOLD_FIELDS.filter((field) => !values[field])
  if (missing.length > 0) {
    return { error: 'Please fill in your name, phone number and address.' }
  }

  const { error } = await supabase
    .from('households')
    .upsert(
      { user_id: user.id, ...values, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )

  if (error) {
    console.error('Failed to save household details:', error)
    return { error: 'Failed to save your details' }
  }
  return { success: true as const }
}
