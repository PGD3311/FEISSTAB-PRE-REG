'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { loadLevelMoves } from './level-moves'

// Standard CLRG dances for populating default levels
const STANDARD_DANCES = ['reel', 'light_jig', 'slip_jig', 'single_jig', 'treble_jig', 'hornpipe']

interface CreateDancerInput {
  first_name: string
  last_name: string
  date_of_birth: string
  gender: 'female' | 'male'
  school_name?: string | null
  school_id?: string | null
  relationship?: 'household' | 'guest'
  tcrg_name?: string | null
  championship_status: 'none' | 'prelim' | 'open'
  default_level: string // e.g., 'NOV'
  level_overrides?: Record<string, string> // dance_key -> level_key overrides
}

export async function createDancer(input: CreateDancerInput) {
  const supabase = await createClient()
  const {
    data: { user }
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
      school_id: input.school_id || null,
      relationship: input.relationship ?? 'household',
      tcrg_name: input.tcrg_name || null,
      championship_status: input.championship_status
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
    source: 'parent' as const
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
  school_id?: string | null
  relationship?: 'household' | 'guest'
  tcrg_name?: string | null
  championship_status: 'none' | 'prelim' | 'open'
  levels: Record<string, string> // dance_key -> level_key
}

export async function updateDancer(dancerId: string, input: UpdateDancerInput) {
  const supabase = await createClient()
  const {
    data: { user }
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
      school_id: input.school_id || null,
      relationship: input.relationship ?? 'household',
      tcrg_name: input.tcrg_name || null,
      championship_status: input.championship_status
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
    source: 'parent' as const
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
    data: { user }
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

  const { error } = await supabase.from('dancers').update({ is_active: false }).eq('id', dancerId)

  if (error) {
    console.error('Failed to archive dancer:', error)
    return { error: 'Failed to archive dancer' }
  }

  return { success: true as const }
}

export interface SchoolOption {
  id: string
  name: string
}

/** Schools whose name contains the search text, for the school picker. */
export async function searchSchools(
  query: string
): Promise<{ schools: SchoolOption[] } | { error: string }> {
  const q = query.trim()
  if (q.length < 2) return { schools: [] }

  const supabase = await createClient()
  // Escape the wildcard characters so a typed % or _ matches literally
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const { data, error } = await supabase
    .from('schools')
    .select('id, name')
    .ilike('name', pattern)
    .order('name', { ascending: true })
    .limit(8)

  if (error) {
    console.error('Failed to search schools:', error)
    return { error: 'The school list could not be searched. Try again.' }
  }
  return { schools: (data ?? []) as SchoolOption[] }
}

/** Adds a school that isn't on the list yet. If it's there under different spacing or capitals, returns that one. */
export async function addSchool(
  name: string
): Promise<{ school: SchoolOption } | { error: string }> {
  const clean = name.trim().replace(/\s+/g, ' ')
  if (clean.length < 2 || clean.length > 120) {
    return { error: 'Enter the school name, between 2 and 120 characters.' }
  }

  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await supabase
    .from('schools')
    .insert({ name: clean, created_by: user.id })
    .select('id, name')
    .single()

  if (!error && data) return { school: data as SchoolOption }

  // 23505 = already on the list under the same name
  if (error?.code === '23505') {
    const { data: existing, error: findError } = await supabase
      .from('schools')
      .select('id, name')
      .eq('name_key', clean.toLowerCase())
      .single()
    if (!findError && existing) return { school: existing as SchoolOption }
  }

  console.error('Failed to add school:', error)
  return { error: 'The school could not be added. Try again.' }
}

/**
 * Moves a dancer up in one dance after a win. The move is worked out again here from the
 * published results, so a family can only accept a move their results actually earned.
 */
export async function acceptLevelMove(dancerId: string, danceKey: string) {
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: household, error: householdError } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (householdError || !household) return { error: 'Household not found' }

  const { data: dancer, error: dancerError } = await supabase
    .from('dancers')
    .select('id')
    .eq('id', dancerId)
    .eq('household_id', household.id)
    .single()
  if (dancerError || !dancer) return { error: 'Dancer not found' }

  const moves = await loadLevelMoves(supabase, [dancerId])
  const move = moves.find((m) => m.danceKey === danceKey)
  if (!move) return { error: 'This level is already up to date.' }

  const { error } = await supabase
    .from('dancer_dance_levels')
    .upsert(
      { dancer_id: dancerId, dance_key: danceKey, level_key: move.toLevel, source: 'result' },
      { onConflict: 'dancer_id,dance_key' }
    )
  if (error) {
    console.error('Failed to accept level move:', error)
    return { error: 'The level could not be updated. Try again.' }
  }

  revalidatePath('/dashboard/dancers')
  revalidatePath(`/dashboard/dancers/${dancerId}`)
  return { ok: true as const }
}
