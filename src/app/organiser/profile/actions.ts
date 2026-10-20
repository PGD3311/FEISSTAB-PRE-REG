'use server'

import { createClient } from '@/lib/supabase/server'
import { parseOrganiserProfile } from '@/lib/approval-gate'

/** Saves the signed-in organiser's details, which a feis needs before it is submitted */
export async function saveOrganiserProfile(
  formData: FormData
): Promise<{ success: true } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const parsed = parseOrganiserProfile(formData)
  if ('error' in parsed) return { error: parsed.error }

  const { error } = await supabase
    .from('organiser_profiles')
    .upsert({ user_id: user.id, ...parsed.values }, { onConflict: 'user_id' })

  if (error) {
    console.error('Failed to save organiser details:', error.message)
    return { error: 'Your details could not be saved. Please try again.' }
  }
  return { success: true }
}
