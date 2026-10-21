import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import type { Dancer, DancerDanceLevel } from '@/lib/types/feis-listing'
import { EnteredFeiseanna } from '@/components/registration/entered-feiseanna'
import { LevelMoveNotice } from '@/components/registration/level-move-notice'
import { loadEnteredFeiseanna } from '../entered-feiseanna'
import { GRADE_LEVELS, loadLevelMoves } from '../level-moves'
import { EditDancerForm } from './edit-dancer-form'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function EditDancerPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user }
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

  const [entered, moves] = await Promise.all([
    loadEnteredFeiseanna(supabase, [dancerTyped.id]),
    loadLevelMoves(supabase, [dancerTyped.id])
  ])

  return (
    <EditDancerForm
      // A level changed elsewhere (a move up) resets the form to the saved levels
      key={JSON.stringify(levelMap)}
      dancer={dancerTyped}
      initialLevels={levelMap}
      numbers={
        <>
          <LevelMoveNotice
            moves={moves}
            dancerNames={{ [dancerTyped.id]: dancerTyped.first_name }}
            levelLabels={Object.fromEntries(GRADE_LEVELS.map((l) => [l.key, l.label]))}
          />
          <EnteredFeiseanna
            dancerName={`${dancerTyped.first_name} ${dancerTyped.last_name}`}
            entries={entered[dancerTyped.id] ?? []}
          />
        </>
      }
    />
  )
}
