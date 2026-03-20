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

export function getEligibleCompetitions(
  dancer: DancerProfile,
  competitions: FeisCompetition[],
  ageCutoffDate: Date,
  levels: Level[]
): EligibleCompetition[] {
  const dancerAge = calculateAgeOnDate(dancer.dob, ageCutoffDate)

  const levelRankMap: Record<string, number> = {}
  for (const level of levels) {
    levelRankMap[level.key] = level.rank
  }

  const enabledComps = competitions.filter(c => c.enabled)

  return enabledComps.map(comp => {
    const ageMatch = ageMatches(dancerAge, comp.age_max_jan1, comp.age_min_jan1)

    if (!ageMatch) {
      return {
        competition: comp,
        eligible: false,
        reason: `age ${dancerAge} does not match ${comp.age_group_label ?? 'age group'}`
      }
    }

    switch (comp.competition_type) {
      case 'solo': {
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
          const eligible = dancer.championshipStatus === 'prelim' || dancer.championshipStatus === 'open'
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

        return { competition: comp, eligible: false, reason: `Unknown championship type: ${comp.championship_key}` }
      }

      case 'special': {
        return { competition: comp, eligible: true, reason: 'Specials are open to all levels' }
      }

      case 'custom': {
        return { competition: comp, eligible: true, reason: 'Custom competition — no eligibility restrictions' }
      }

      default: {
        return { competition: comp, eligible: false, reason: `Unknown competition type: ${comp.competition_type}` }
      }
    }
  })
}
