import type { AgeGroup, FeisCompetition } from '@/lib/types/feis-listing'

export interface MergeOptions {
  /** A competition with fewer than this many entries (but more than 0) is "small". Integer >= 1. */
  minEntries: number
  /**
   * Canonical youngest → oldest age group order — pass the listing's frozen
   * `syllabus_snapshot.age_groups`. Two age groups are adjacent only when they sit next to each
   * other in this list; a missing competition in between (not offered, disabled, or empty) breaks
   * adjacency. Competitions whose age_group_key is not in this list are never merged.
   */
  ageGroups: AgeGroup[]
}

/** One proposed combined competition. Suggestion only — the organiser confirms elsewhere. */
export interface MergeSuggestion {
  /** Competitions to combine, youngest → oldest. Always 2 or more. */
  competitionIds: string[]
  /** Age group keys of competitionIds, same order. */
  ageGroupKeys: string[]
  levelKey: string
  danceKey: string
  totalEntries: number
  /** Readable label, e.g. "U10 + U11". */
  label: string
  /** Younger dancers dance up: the merged competition runs as its oldest age group. */
  competesAsAgeGroupKey: string
  competesAsAgeGroupLabel: string | null
  /** True when the whole run of adjacent small competitions still totals < minEntries. */
  belowMinimum: boolean
}

/** A small competition that stays as-is because no adjacent age group in its lane is also small. */
export interface UnmergeableCompetition {
  competitionId: string
  entries: number
}

/**
 * Result buckets. Every enabled solo competition with fewer than minEntries entries lands in
 * exactly one bucket; competitions at/above minEntries appear in none.
 * - merges: runs of adjacent small competitions to combine
 * - unmergeable: small (1..minEntries-1) competitions with no small adjacent neighbour
 * - empty: competition ids with 0 entries — candidates for cancellation, never merged.
 *   An empty competition also breaks adjacency for its neighbours.
 */
export interface MergeSuggestionResult {
  merges: MergeSuggestion[]
  unmergeable: UnmergeableCompetition[]
  empty: string[]
}

interface LaneItem {
  competition: FeisCompetition
  ageGroupKey: string
  levelKey: string
  danceKey: string
  agePosition: number
  entries: number
}

/**
 * Suggests how to combine under-subscribed solo competitions after registration closes.
 *
 * Pure function — no side effects, no DB calls.
 *
 * Rules:
 * - Only enabled `solo` competitions are considered. Championships, specials and custom
 *   competitions are never merged and never reported.
 * - Competitions merge only within a lane: same level_key and dance_key (and solo type).
 *   FeisCompetition has no gender column, so gender is not part of the lane.
 * - Competitions with >= minEntries are never merged. Only runs of consecutive small
 *   competitions in adjacent age groups merge with each other.
 * - Within a run (youngest → oldest), a group starts at the first competition and absorbs the
 *   next one until its total reaches minEntries. A trailing group that falls short is folded
 *   back into the previous group. If the whole run is short, it is still suggested with
 *   belowMinimum: true.
 * - Entry counts missing from entryCounts are treated as 0.
 *
 * Output order is deterministic and independent of input order: lanes sorted by level_key then
 * dance_key, then by youngest age group. `empty` and `unmergeable` follow the same ordering.
 */
export function suggestMerges(
  competitions: FeisCompetition[],
  entryCounts: Record<string, number>,
  options: MergeOptions
): MergeSuggestionResult {
  const { minEntries, ageGroups } = options
  if (!Number.isInteger(minEntries) || minEntries < 1) {
    throw new RangeError(`minEntries must be an integer >= 1, got ${minEntries}`)
  }

  const agePositions = new Map(ageGroups.map((age, index) => [age.key, index]))

  // Group candidate competitions into lanes. Unknown-age competitions get their own lane each
  // (position -1) so they are classified but can never be adjacent to anything.
  const lanes = new Map<string, LaneItem[]>()
  for (const competition of competitions) {
    if (!competition.enabled || competition.competition_type !== 'solo') continue
    const { age_group_key, level_key, dance_key } = competition
    if (age_group_key === null || level_key === null || dance_key === null) continue

    const entries = entryCounts[competition.id] ?? 0
    if (!Number.isInteger(entries) || entries < 0) {
      throw new RangeError(`Entry count for ${competition.id} must be a non-negative integer`)
    }

    const position = agePositions.get(age_group_key)
    const laneKey =
      position === undefined
        ? JSON.stringify([level_key, dance_key, `unknown:${competition.id}`])
        : JSON.stringify([level_key, dance_key])
    const lane = lanes.get(laneKey) ?? []
    lane.push({
      competition,
      ageGroupKey: age_group_key,
      levelKey: level_key,
      danceKey: dance_key,
      agePosition: position ?? -1,
      entries
    })
    lanes.set(laneKey, lane)
  }

  const merges: MergeSuggestion[] = []
  const unmergeable: UnmergeableCompetition[] = []
  const empty: string[] = []

  const sortedLaneKeys = [...lanes.keys()].sort(compareStrings)
  for (const laneKey of sortedLaneKeys) {
    const lane = (lanes.get(laneKey) ?? []).sort(
      (a, b) => a.agePosition - b.agePosition || compareStrings(a.competition.id, b.competition.id)
    )

    let run: LaneItem[] = []
    const flushRun = () => {
      if (run.length === 1) {
        unmergeable.push({ competitionId: run[0].competition.id, entries: run[0].entries })
      } else if (run.length > 1) {
        merges.push(...partitionRun(run, minEntries))
      }
      run = []
    }

    for (const item of lane) {
      if (item.entries >= minEntries) {
        flushRun()
        continue
      }
      if (item.entries === 0) {
        flushRun()
        empty.push(item.competition.id)
        continue
      }
      const previous = run[run.length - 1]
      const adjacent = previous !== undefined && item.agePosition - previous.agePosition === 1
      if (!adjacent) flushRun()
      run.push(item)
    }
    flushRun()
  }

  return { merges, unmergeable, empty }
}

/** Greedy youngest → oldest partition of a run (length >= 2) of adjacent small competitions. */
function partitionRun(run: LaneItem[], minEntries: number): MergeSuggestion[] {
  const groups: LaneItem[][] = []
  let current: LaneItem[] = []
  let currentTotal = 0

  for (const item of run) {
    current.push(item)
    currentTotal += item.entries
    if (currentTotal >= minEntries) {
      groups.push(current)
      current = []
      currentTotal = 0
    }
  }

  if (current.length > 0) {
    const previousGroup = groups[groups.length - 1]
    if (previousGroup) {
      previousGroup.push(...current)
    } else {
      groups.push(current)
    }
  }

  return groups.map((group) => buildSuggestion(group, minEntries))
}

function buildSuggestion(group: LaneItem[], minEntries: number): MergeSuggestion {
  const oldest = group[group.length - 1]
  const ageGroupKeys = group.map((item) => item.ageGroupKey)
  const totalEntries = group.reduce((sum, item) => sum + item.entries, 0)

  return {
    competitionIds: group.map((item) => item.competition.id),
    ageGroupKeys,
    levelKey: oldest.levelKey,
    danceKey: oldest.danceKey,
    totalEntries,
    label: ageGroupKeys.join(' + '),
    competesAsAgeGroupKey: oldest.ageGroupKey,
    competesAsAgeGroupLabel: oldest.competition.age_group_label,
    belowMinimum: totalEntries < minEntries
  }
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
