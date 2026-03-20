'use server'

import { createClient } from '@/lib/supabase/server'

// Standard CLRG dances for populating default levels
const STANDARD_DANCES = ['reel', 'light_jig', 'slip_jig', 'single_jig', 'treble_jig', 'hornpipe']

interface CreateDancerInput {
  first_name: string
  last_name: string
  date_of_birth: string
  gender: 'female' | 'male'
  school_name?: string | null
  tcrg_name?: string | null
  championship_status: 'none' | 'prelim' | 'open'
  default_level: string // e.g., 'NOV'
  level_overrides?: Record<string, string> // dance_key -> level_key overrides
}

export async function createDancer(input: CreateDancerInput) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: 'Not authenticated' }

  // Get household
  const { data: household, error: householdError } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (householdError || !household) {
    return { error: 'Household not found' }
  }

  // Create dancer
  const { data: dancer, error: dancerError } = await supabase
    .from('dancers')
    .insert({
      household_id: household.id,
      first_name: input.first_name,
      last_name: input.last_name,
      date_of_birth: input.date_of_birth,
      gender: input.gender,
      school_name: input.school_name || null,
      tcrg_name: input.tcrg_name || null,
      championship_status: input.championship_status,
    })
    .select('id')
    .single()

  if (dancerError || !dancer) {
    console.error('Failed to create dancer:', dancerError)
    return { error: 'Failed to create dancer' }
  }

  // Create dance levels for all standard dances
  const levels = STANDARD_DANCES.map((danceKey) => ({
    dancer_id: dancer.id,
    dance_key: danceKey,
    level_key: input.level_overrides?.[danceKey] ?? input.default_level,
    source: 'parent' as const,
  }))

  const { error: levelsError } = await supabase.from('dancer_dance_levels').insert(levels)

  if (levelsError) {
    console.error('Failed to create dance levels:', levelsError)
    return { error: 'Failed to create dance levels' }
  }

  return { id: dancer.id }
}

interface UpdateDancerInput {
  first_name: string
  last_name: string
  date_of_birth: string
  gender: 'female' | 'male'
  school_name?: string | null
  tcrg_name?: string | null
  championship_status: 'none' | 'prelim' | 'open'
  levels: Record<string, string> // dance_key -> level_key
}

export async function updateDancer(dancerId: string, input: UpdateDancerInput) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: 'Not authenticated' }

  // Get household
  const { data: household, error: householdError } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (householdError || !household) {
    return { error: 'Household not found' }
  }

  // Verify dancer belongs to this household
  const { data: dancerCheck, error: dancerCheckError } = await supabase
    .from('dancers')
    .select('id')
    .eq('id', dancerId)
    .eq('household_id', household.id)
    .single()

  if (dancerCheckError || !dancerCheck) {
    return { error: 'Dancer not found' }
  }

  // Update dancer profile
  const { error: dancerError } = await supabase
    .from('dancers')
    .update({
      first_name: input.first_name,
      last_name: input.last_name,
      date_of_birth: input.date_of_birth,
      gender: input.gender,
      school_name: input.school_name || null,
      tcrg_name: input.tcrg_name || null,
      championship_status: input.championship_status,
    })
    .eq('id', dancerId)

  if (dancerError) {
    console.error('Failed to update dancer:', dancerError)
    return { error: 'Failed to update dancer' }
  }

  // Upsert dance levels (safer than delete-and-reinsert — if upsert fails, old data preserved)
  const levelRows = Object.entries(input.levels).map(([dance_key, level_key]) => ({
    dancer_id: dancerId,
    dance_key,
    level_key,
    source: 'parent' as const,
  }))

  if (levelRows.length > 0) {
    const { error: levelsError } = await supabase
      .from('dancer_dance_levels')
      .upsert(levelRows, { onConflict: 'dancer_id,dance_key' })

    if (levelsError) {
      console.error('Failed to update dance levels:', levelsError)
      return { error: 'Failed to update dance levels' }
    }
  }

  // Delete levels for dances no longer in the list
  const currentDanceKeys = Object.keys(input.levels)
  if (currentDanceKeys.length > 0) {
    const { error: cleanupError } = await supabase
      .from('dancer_dance_levels')
      .delete()
      .eq('dancer_id', dancerId)
      .filter('dance_key', 'not.in', `(${currentDanceKeys.join(',')})`)

    if (cleanupError) {
      console.error('Failed to clean up removed dance levels:', cleanupError)
      // Non-fatal — extra levels are harmless
    }
  } else {
    // No levels at all — delete everything
    const { error: deleteError } = await supabase
      .from('dancer_dance_levels')
      .delete()
      .eq('dancer_id', dancerId)

    if (deleteError) {
      console.error('Failed to clear dance levels:', deleteError)
      return { error: 'Failed to clear dance levels' }
    }
  }

  return { success: true as const }
}

export async function archiveDancer(dancerId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: 'Not authenticated' }

  // Get household
  const { data: household, error: householdError } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (householdError || !household) {
    return { error: 'Household not found' }
  }

  // Verify dancer belongs to this household
  const { data: dancerCheck, error: dancerCheckError } = await supabase
    .from('dancers')
    .select('id')
    .eq('id', dancerId)
    .eq('household_id', household.id)
    .single()

  if (dancerCheckError || !dancerCheck) {
    return { error: 'Dancer not found' }
  }

  const { error } = await supabase
    .from('dancers')
    .update({ is_active: false })
    .eq('id', dancerId)

  if (error) {
    console.error('Failed to archive dancer:', error)
    return { error: 'Failed to archive dancer' }
  }

  return { success: true as const }
}
