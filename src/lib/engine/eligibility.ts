import type {
  DancerProfile,
  FeisCompetition,
  EligibleCompetition,
  Level
} from '@/lib/types/feis-listing'

export function calculateAgeOnDate(dob: Date, referenceDate: Date): number {
  let age = referenceDate.getFullYear() - dob.getFullYear()
  const monthDiff = referenceDate.getMonth() - dob.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && referenceDate.getDate() < dob.getDate())) {
    age--
  }
  return age
}

/**
 * A dancer's age for entering competitions: their age on the cutoff date (normally January 1),
 * except that a dancer whose birthday falls on the cutoff date counts as the younger age
 * (MAR Feis Rules §2.1).
 */
export function competitionAge(dob: Date, cutoff: Date): number {
  const age = calculateAgeOnDate(dob, cutoff)
  const birthdayOnCutoff =
    dob.getMonth() === cutoff.getMonth() && dob.getDate() === cutoff.getDate()
  return birthdayOnCutoff ? age - 1 : age
}

function ageMatches(
  dancerAge: number,
  ageMaxJan1: number | null,
  ageMinJan1: number | null
): boolean {
  if (ageMaxJan1 === null && ageMinJan1 === null) return true
  if (ageMaxJan1 !== null && dancerAge > ageMaxJan1) return false
  if (ageMinJan1 !== null && dancerAge < ageMinJan1) return false
  return true
}

/**
 * How closely a competition's age group fits: lower is tighter. "Under 12" (max 11) fits an
 * 11-year-old more tightly than "Under 13"; for open-ended groups like "18 & Over" vs
 * "21 & Over", the higher minimum is tighter.
 */
function ageGroupTightness(comp: FeisCompetition): number {
  if (comp.age_max_jan1 !== null) return comp.age_max_jan1
  if (comp.age_min_jan1 !== null) return 1000 - comp.age_min_jan1
  return 2000
}

/**
 * A dancer dances in their own age group (their age on January 1), not in older ones.
 * Among solo and championship competitions the dancer could otherwise enter, only those in the
 * tightest-fitting age group for each dance, level and championship stay eligible.
 */
function keepOwnAgeGroup(results: EligibleCompetition[]): EligibleCompetition[] {
  const kindOf = (c: FeisCompetition) =>
    [c.competition_type, c.dance_key, c.level_key, c.championship_key].join('|')
  const best = new Map<string, EligibleCompetition>()
  for (const r of results) {
    const c = r.competition
    if (!r.eligible || (c.competition_type !== 'solo' && c.competition_type !== 'championship')) {
      continue
    }
    const current = best.get(kindOf(c))
    if (!current || ageGroupTightness(c) < ageGroupTightness(current.competition)) {
      best.set(kindOf(c), r)
    }
  }

  return results.map((r) => {
    const c = r.competition
    const own = best.get(kindOf(c))
    if (!r.eligible || !own || ageGroupTightness(c) === ageGroupTightness(own.competition)) {
      return r
    }
    return {
      competition: c,
      eligible: false,
      reason: `Dances in their own age group (${own.competition.age_group_label ?? 'a younger group'})`
    }
  })
}

export function getEligibleCompetitions(
  dancer: DancerProfile,
  competitions: FeisCompetition[],
  ageCutoffDate: Date,
  levels: Level[]
): EligibleCompetition[] {
  return keepOwnAgeGroup(checkEachCompetition(dancer, competitions, ageCutoffDate, levels))
}

function checkEachCompetition(
  dancer: DancerProfile,
  competitions: FeisCompetition[],
  ageCutoffDate: Date,
  levels: Level[]
): EligibleCompetition[] {
  const dancerAge = competitionAge(dancer.dob, ageCutoffDate)

  const levelRankMap: Record<string, number> = {}
  for (const level of levels) {
    levelRankMap[level.key] = level.rank
  }

  const enabledComps = competitions.filter((c) => c.enabled)

  return enabledComps.map((comp) => {
    const ageMatch = ageMatches(dancerAge, comp.age_max_jan1, comp.age_min_jan1)

    if (!ageMatch) {
      return {
        competition: comp,
        eligible: false,
        reason: `age ${dancerAge} does not match ${comp.age_group_label ?? 'age group'}`
      }
    }

    if (comp.grades_only && dancer.championshipStatus !== 'none') {
      return {
        competition: comp,
        eligible: false,
        reason: 'Only for grades dancers (not prelim or open championship)'
      }
    }

    switch (comp.competition_type) {
      case 'solo': {
        // MAR Feis Rules §2.14: championship dancers may not enter grade competitions
        if (dancer.championshipStatus !== 'none') {
          return {
            competition: comp,
            eligible: false,
            reason: 'Prelim and Open champions do not enter grade competitions'
          }
        }

        if (!comp.dance_key || !comp.level_key) {
          return { competition: comp, eligible: true, reason: 'Age matches' }
        }

        const dancerLevelKey = dancer.danceLevels[comp.dance_key]
        if (!dancerLevelKey) {
          return {
            competition: comp,
            eligible: false,
            reason: `No level set for ${comp.dance_label ?? comp.dance_key}`
          }
        }

        const dancerRank = levelRankMap[dancerLevelKey]
        const compRank = levelRankMap[comp.level_key]

        if (dancerRank === undefined || compRank === undefined) {
          return {
            competition: comp,
            eligible: false,
            reason: `Unknown level: ${dancerLevelKey} or ${comp.level_key}`
          }
        }

        if (dancerRank === compRank) {
          return { competition: comp, eligible: true, reason: 'Age and level match' }
        }

        return {
          competition: comp,
          eligible: false,
          reason: `Level mismatch: dancer is ${dancerLevelKey}, competition requires ${comp.level_key}`
        }
      }

      case 'championship': {
        if (comp.championship_key === 'prelim') {
          // Open champions have moved up from prelim and don't go back
          const eligible = dancer.championshipStatus === 'prelim'
          return {
            competition: comp,
            eligible,
            reason: eligible
              ? 'Age matches, championship status qualifies'
              : `championship status '${dancer.championshipStatus}' insufficient for Preliminary championship`
          }
        }

        if (comp.championship_key === 'open') {
          const eligible = dancer.championshipStatus === 'open'
          return {
            competition: comp,
            eligible,
            reason: eligible
              ? 'Age matches, championship status qualifies'
              : `championship status '${dancer.championshipStatus}' insufficient for Open championship`
          }
        }

        return {
          competition: comp,
          eligible: false,
          reason: `Unknown championship type: ${comp.championship_key}`
        }
      }

      case 'special': {
        return { competition: comp, eligible: true, reason: 'Specials are open to all levels' }
      }

      case 'custom': {
        return {
          competition: comp,
          eligible: true,
          reason: 'Custom competition — no eligibility restrictions'
        }
      }

      default: {
        return {
          competition: comp,
          eligible: false,
          reason: `Unknown competition type: ${comp.competition_type}`
        }
      }
    }
  })
}
