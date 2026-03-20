'use server'

import { createClient } from '@/lib/supabase/server'

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
