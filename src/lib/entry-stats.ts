import type { FeisCompetition } from '@/lib/types/feis-listing'

export interface StatEntry {
  dancerId: string
  competitionId: string
  status: string
}

export interface LevelCount {
  label: string
  dancers: number
  entries: number
}

export interface EntryStats {
  paidEntries: number
  paidDancers: number
  /** Dancer ids with a paid entry, per competition id */
  dancersByCompetition: Map<string, string[]>
  /** Paid entries and dancers per level, in syllabus order */
  byLevel: LevelCount[]
}

/** What an organiser calls the "level" of a competition when counting who's coming. */
export function levelOf(
  comp: Pick<FeisCompetition, 'competition_type' | 'level_label' | 'championship_key'>
): string {
  if (comp.competition_type === 'solo') return comp.level_label ?? 'Solo dances'
  if (comp.competition_type === 'championship') {
    return comp.championship_key === 'open' ? 'Open championship' : 'Preliminary championship'
  }
  return 'Specials and other'
}

/**
 * Counts for the organiser's entries view. Only paid entries count as entered; families still
 * paying are reported separately by the caller. `competitions` should be in syllabus order.
 */
export function summariseEntries(
  entries: StatEntry[],
  competitions: FeisCompetition[]
): EntryStats {
  const paid = entries.filter((e) => e.status === 'paid')
  const compById = new Map(competitions.map((c) => [c.id, c]))

  const dancersByCompetition = new Map<string, string[]>()
  for (const e of paid) {
    const list = dancersByCompetition.get(e.competitionId) ?? []
    list.push(e.dancerId)
    dancersByCompetition.set(e.competitionId, list)
  }

  const levelOrder: string[] = []
  for (const c of competitions) {
    const label = levelOf(c)
    if (!levelOrder.includes(label)) levelOrder.push(label)
  }

  const levels = new Map<string, { dancers: Set<string>; entries: number }>()
  for (const e of paid) {
    const comp = compById.get(e.competitionId)
    if (!comp) continue
    const label = levelOf(comp)
    const bucket = levels.get(label) ?? { dancers: new Set<string>(), entries: 0 }
    bucket.dancers.add(e.dancerId)
    bucket.entries += 1
    levels.set(label, bucket)
  }

  const byLevel = levelOrder
    .filter((label) => levels.has(label))
    .map((label) => ({
      label,
      dancers: levels.get(label)?.dancers.size ?? 0,
      entries: levels.get(label)?.entries ?? 0
    }))

  return {
    paidEntries: paid.length,
    paidDancers: new Set(paid.map((e) => e.dancerId)).size,
    dancersByCompetition,
    byLevel
  }
}
