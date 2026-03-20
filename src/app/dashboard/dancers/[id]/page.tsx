import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import type { Dancer, DancerDanceLevel } from '@/lib/types/feis-listing'
import { EditDancerForm } from './edit-dancer-form'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function EditDancerPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  // Verify household ownership
  const { data: household } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!household) redirect('/auth/onboarding')

  const { data: dancer, error: dancerError } = await supabase
    .from('dancers')
    .select('*')
    .eq('id', id)
    .eq('household_id', household.id)
    .single()

  if (dancerError || !dancer) {
    notFound()
  }

  const { data: levelRows, error: levelsError } = await supabase
    .from('dancer_dance_levels')
    .select('*')
    .eq('dancer_id', id)

  if (levelsError) {
    console.error('Failed to load dance levels:', levelsError)
  }

  const dancerTyped = dancer as Dancer
  const levels = (levelRows ?? []) as DancerDanceLevel[]

  // Build level map from DB rows
  const levelMap: Record<string, string> = {}
  for (const row of levels) {
    levelMap[row.dance_key] = row.level_key
  }

  return (
    <EditDancerForm
      dancer={dancerTyped}
      initialLevels={levelMap}
    />
  )
}
