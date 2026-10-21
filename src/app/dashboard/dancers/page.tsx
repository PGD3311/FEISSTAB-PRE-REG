import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { parseLocalDate } from '@/lib/format'
import { dancerLevelSummary } from '@/lib/entry-display'
import type { Dancer, Level } from '@/lib/types/feis-listing'
import { PageTitle } from '@/components/page-title'
import { NumberTags } from '@/components/registration/entered-feiseanna'
import { LevelMoveNotice } from '@/components/registration/level-move-notice'
import { loadEnteredFeiseanna } from './entered-feiseanna'
import { loadLevelMoves } from './level-moves'

export const dynamic = 'force-dynamic'

function calcAge(dob: string): number {
  const today = new Date()
  const birth = parseLocalDate(dob)
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

// The standard grade levels; a feis's own syllabus can name others, which show by key
const LEVELS: Level[] = [
  { key: 'BG', label: 'Beginner', rank: 1 },
  { key: 'AB', label: 'Advanced Beginner', rank: 2 },
  { key: 'NOV', label: 'Novice', rank: 3 },
  { key: 'PW', label: 'Prizewinner', rank: 4 }
]

export default async function DancersPage() {
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const { data: household } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!household) redirect('/auth/onboarding')

  const { data: dancers, error } = await supabase
    .from('dancers')
    .select('*, dance_levels:dancer_dance_levels(dance_key, level_key)')
    .eq('household_id', household.id)
    .eq('is_active', true)
    .order('first_name', { ascending: true })

  if (error) {
    console.error('Failed to load dancers:', error)
  }

  const activeDancers = (dancers ?? []) as (Dancer & {
    dance_levels: { dance_key: string; level_key: string }[]
  })[]
  const dancerIds = activeDancers.map((d) => d.id)
  const [entered, moves] = await Promise.all([
    loadEnteredFeiseanna(supabase, dancerIds),
    loadLevelMoves(supabase, dancerIds)
  ])

  return (
    <div>
      <PageTitle
        title="Dancers"
        intro="Set each dancer up once with their school and levels. Every feis then shows only the competitions they can enter."
        action={
          activeDancers.length > 0 ? (
            <Link href="/dashboard/dancers/new" className="feis-btn feis-btn-primary">
              Add a dancer
            </Link>
          ) : undefined
        }
      />

      <LevelMoveNotice
        moves={moves}
        dancerNames={Object.fromEntries(activeDancers.map((d) => [d.id, d.first_name]))}
        levelLabels={Object.fromEntries(LEVELS.map((l) => [l.key, l.label]))}
      />

      {activeDancers.length === 0 ? (
        <div className="feis-sticker max-w-3xl rounded px-5 py-5">
          <p className="font-bold">No dancers yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add your first dancer to start entering feiseanna.
          </p>
          <Link href="/dashboard/dancers/new" className="feis-btn feis-btn-ink mt-4">
            Add a dancer
          </Link>
        </div>
      ) : (
        <ul className="max-w-3xl border-b-[1.5px] border-[var(--color-feis-charcoal)]">
          {activeDancers.map((dancer, i) => (
            <li
              key={dancer.id}
              className={
                i === 0
                  ? 'border-t-[1.5px] border-[var(--color-feis-charcoal)]'
                  : 'border-t border-[#E2DCCD]'
              }
            >
              <Link
                href={`/dashboard/dancers/${dancer.id}`}
                className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 px-1 py-4 hover:bg-white"
              >
                <div className="min-w-0">
                  <p className="text-[20px] leading-tight font-extrabold [font-stretch:75%] group-hover:underline">
                    {dancer.first_name} {dancer.last_name}
                    {dancer.relationship === 'guest' && (
                      <span className="ml-2 inline-block rounded-[2px] bg-[var(--color-feis-cream-dark)] px-1.5 py-0.5 align-middle text-xs font-bold text-muted-foreground [font-stretch:100%]">
                        Guest
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Age {calcAge(dancer.date_of_birth)}
                    {dancer.school_name ? `, ${dancer.school_name}` : ''}
                  </p>
                  <p className="mt-0.5 text-sm">
                    {dancerLevelSummary(dancer.dance_levels, LEVELS, dancer.championship_status)}
                  </p>
                  <NumberTags entries={entered[dancer.id] ?? []} />
                </div>
                <span className="text-sm font-bold text-[var(--color-feis-green)]">Edit</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
