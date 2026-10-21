import type { createClient } from '@/lib/supabase/server'
import { createFeisDayClient, createServiceClient } from '@/lib/supabase/service'
import { safeErrorMessage } from '@/lib/redact-secrets'
import { levelMoves, type DancerResult, type LevelMove } from '@/lib/engine/level-moves'
import type { Level } from '@/lib/types/feis-listing'

type ServerClient = Awaited<ReturnType<typeof createClient>>

// The standard grade levels, as on the dancers pages
export const GRADE_LEVELS: Level[] = [
  { key: 'BG', label: 'Beginner', rank: 1 },
  { key: 'AB', label: 'Advanced Beginner', rank: 2 },
  { key: 'NOV', label: 'Novice', rank: 3 },
  { key: 'PW', label: 'Prizewinner', rank: 4 }
]

interface ResultRow {
  competition_id: string
  dancer_id: string
  final_rank: number
  competitions: {
    prereg_feis_competition_id: string | null
    events: { name: string; start_date: string | null } | null
  } | null
}

/**
 * The level moves earned by these dancers' published feis-day results. The dancer ids must
 * already be checked as the signed-in family's own: the feis-day tables are read with the
 * service key. Any read failure is logged and yields no moves, so the page still loads.
 */
export async function loadLevelMoves(
  supabase: ServerClient,
  dancerIds: string[]
): Promise<LevelMove[]> {
  if (dancerIds.length === 0) return []
  try {
    const feisDay = createFeisDayClient()

    const linked = await feisDay
      .from('dancers')
      .select('id, prereg_dancer_id')
      .in('prereg_dancer_id', dancerIds)
    if (linked.error) throw new Error(linked.error.message)
    const preregOf = new Map(
      (linked.data ?? []).map((d) => [d.id as string, d.prereg_dancer_id as string])
    )
    if (preregOf.size === 0) return []

    const own = await feisDay
      .from('results')
      .select(
        'competition_id, dancer_id, final_rank, competitions(prereg_feis_competition_id, events(name, start_date))'
      )
      .in('dancer_id', [...preregOf.keys()])
      .not('published_at', 'is', null)
    if (own.error) throw new Error(own.error.message)
    const rows = (own.data ?? []) as unknown as ResultRow[]
    if (rows.length === 0) return []

    const competitionIds = [...new Set(rows.map((r) => r.competition_id))]
    const preregCompetitionIds = [
      ...new Set(
        rows.flatMap((r) =>
          r.competitions?.prereg_feis_competition_id ? [r.competitions.prereg_feis_competition_id] : []
        )
      )
    ]

    const [fields, competitions, levelRows] = await Promise.all([
      feisDay
        .from('results')
        .select('competition_id')
        .in('competition_id', competitionIds)
        .not('published_at', 'is', null),
      // Parents can read a feis's competitions only while it's open; these ids come from the
      // family's own results, so the service client reads them after the feis has closed
      createServiceClient()
        .from('feis_competitions')
        .select('id, competition_type, dance_key, dance_label, level_key')
        .in('id', preregCompetitionIds),
      supabase
        .from('dancer_dance_levels')
        .select('dancer_id, dance_key, level_key')
        .in('dancer_id', dancerIds)
    ])
    if (fields.error) throw new Error(fields.error.message)
    if (competitions.error) throw new Error(competitions.error.message)
    if (levelRows.error) throw new Error(levelRows.error.message)

    const fieldSize = new Map<string, number>()
    for (const r of fields.data ?? []) {
      const id = r.competition_id as string
      fieldSize.set(id, (fieldSize.get(id) ?? 0) + 1)
    }
    const competitionById = new Map((competitions.data ?? []).map((c) => [c.id as string, c]))

    const results: DancerResult[] = rows.flatMap((r) => {
      const dancerId = preregOf.get(r.dancer_id)
      const comp = competitionById.get(r.competitions?.prereg_feis_competition_id ?? '')
      if (!dancerId || !comp) return []
      return [
        {
          dancerId,
          feisName: r.competitions?.events?.name ?? 'a feis',
          feisDate: r.competitions?.events?.start_date ?? null,
          competitionType: comp.competition_type as string,
          danceKey: comp.dance_key as string | null,
          danceLabel: comp.dance_label as string | null,
          levelKey: comp.level_key as string | null,
          place: r.final_rank,
          dancersInCompetition: fieldSize.get(r.competition_id) ?? 0
        }
      ]
    })

    const current: Record<string, Record<string, string>> = {}
    for (const row of levelRows.data ?? []) {
      const byDance = (current[row.dancer_id as string] ??= {})
      byDance[row.dance_key as string] = row.level_key as string
    }

    return levelMoves(results, current, GRADE_LEVELS)
  } catch (error) {
    console.error('Failed to load level moves:', safeErrorMessage(error))
    return []
  }
}
