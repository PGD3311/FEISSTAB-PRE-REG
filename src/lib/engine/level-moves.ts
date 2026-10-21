import type { Level } from '@/lib/types/feis-listing'

/** One published feis-day result for a family's dancer, joined to its registration competition. */
export interface DancerResult {
  dancerId: string
  feisName: string
  feisDate: string | null
  competitionType: string
  danceKey: string | null
  danceLabel: string | null
  levelKey: string | null
  place: number
  dancersInCompetition: number
}

/** A level a dancer has won out of in one dance, and the result that earned the move. */
export interface LevelMove {
  dancerId: string
  danceKey: string
  danceLabel: string
  fromLevel: string | null
  toLevel: string
  because: {
    feisName: string
    feisDate: string | null
    levelKey: string
    place: number
    dancersInCompetition: number
  }
}

// MAR Feis Rules §2.17: a placing changes a dancer's status only with five or more dancers
export const MIN_DANCERS_FOR_LEVEL_MOVE = 5

// MAR Feis Rules §5: per dance, Advanced Beginner moves up on a 1st–3rd, Novice on a 1st
const WIN_OUT: Record<string, { to: string; worstPlace: number }> = {
  AB: { to: 'NOV', worstPlace: 3 },
  NOV: { to: 'PW', worstPlace: 1 }
}

/**
 * The level moves a family's results call for: one per dancer and dance, to the highest level
 * earned, and only where the dancer's current level for that dance is below it. Where several
 * results earn the same level, the most recent is the one shown.
 */
export function levelMoves(
  results: DancerResult[],
  currentLevels: Record<string, Record<string, string>>,
  levels: Level[]
): LevelMove[] {
  const rank = (key: string | null | undefined) =>
    levels.find((l) => l.key === key)?.rank ?? 0

  const best = new Map<string, LevelMove>()
  for (const r of results) {
    if (r.competitionType !== 'solo' || !r.danceKey || !r.levelKey) continue
    const rule = WIN_OUT[r.levelKey]
    if (!rule || r.place < 1 || r.place > rule.worstPlace) continue
    if (r.dancersInCompetition < MIN_DANCERS_FOR_LEVEL_MOVE) continue

    const fromLevel = currentLevels[r.dancerId]?.[r.danceKey] ?? null
    if (rank(fromLevel) >= rank(rule.to)) continue

    const key = `${r.dancerId}|${r.danceKey}`
    const current = best.get(key)
    const higher = !current || rank(rule.to) > rank(current.toLevel)
    const sameButNewer =
      current &&
      rule.to === current.toLevel &&
      (r.feisDate ?? '') > (current.because.feisDate ?? '')
    if (!higher && !sameButNewer) continue

    best.set(key, {
      dancerId: r.dancerId,
      danceKey: r.danceKey,
      danceLabel: r.danceLabel ?? r.danceKey,
      fromLevel,
      toLevel: rule.to,
      because: {
        feisName: r.feisName,
        feisDate: r.feisDate,
        levelKey: r.levelKey,
        place: r.place,
        dancersInCompetition: r.dancersInCompetition
      }
    })
  }
  return [...best.values()]
}

/** "1st", "2nd", "3rd", "4th" … */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10]
  return `${n}${suffix ?? 'th'}`
}
