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

export interface AgeLevelGrid {
  /** Age groups that have paid entries, in syllabus order */
  ageGroups: string[]
  /** Levels that have paid entries, in syllabus order */
  levels: string[]
  /** Distinct dancers per age group and level, keyed `${ageGroup}|${level}` */
  cells: Record<string, number>
  /** Distinct dancers per age group, across all levels */
  ageTotals: Record<string, number>
}

export interface EntryStats {
  paidEntries: number
  paidDancers: number
  /** Dancer ids with a paid entry, per competition id */
  dancersByCompetition: Map<string, string[]>
  /** Paid entries and dancers per level, in syllabus order */
  byLevel: LevelCount[]
  /** Dancers per age group and level, for spotting busy and thin groups */
  ageLevelGrid: AgeLevelGrid
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

  // Age group by level: solos and championships only (specials usually span ages)
  const ageOrder: string[] = []
  for (const c of competitions) {
    if (c.competition_type !== 'solo' && c.competition_type !== 'championship') continue
    const age = c.age_group_label
    if (age && !ageOrder.includes(age)) ageOrder.push(age)
  }
  const cellSets = new Map<string, Set<string>>()
  const ageSets = new Map<string, Set<string>>()
  for (const e of paid) {
    const comp = compById.get(e.competitionId)
    if (!comp || !comp.age_group_label) continue
    if (comp.competition_type !== 'solo' && comp.competition_type !== 'championship') continue
    const key = `${comp.age_group_label}|${levelOf(comp)}`
    const cell = cellSets.get(key) ?? new Set<string>()
    cell.add(e.dancerId)
    cellSets.set(key, cell)
    const ageSet = ageSets.get(comp.age_group_label) ?? new Set<string>()
    ageSet.add(e.dancerId)
    ageSets.set(comp.age_group_label, ageSet)
  }
  const gridLevels = levelOrder.filter((label) =>
    [...cellSets.keys()].some((k) => k.endsWith(`|${label}`))
  )

  return {
    ageLevelGrid: {
      ageGroups: ageOrder.filter((a) => ageSets.has(a)),
      levels: gridLevels,
      cells: Object.fromEntries([...cellSets].map(([k, v]) => [k, v.size])),
      ageTotals: Object.fromEntries([...ageSets].map(([k, v]) => [k, v.size]))
    },
    paidEntries: paid.length,
    paidDancers: new Set(paid.map((e) => e.dancerId)).size,
    dancersByCompetition,
    byLevel
  }
}
