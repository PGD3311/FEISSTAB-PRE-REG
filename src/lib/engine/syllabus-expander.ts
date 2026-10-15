import type {
  Level,
  TemplateData,
  SyllabusSelection,
  ExpandedCompetition,
  FeeCategoryType,
  ChampionshipKey
} from '@/lib/types/feis-listing'

// Abbreviations used on most US syllabi, e.g. 210R, 412TJ
const DANCE_CODES: Record<string, string> = {
  reel: 'R',
  light_jig: 'LJ',
  slip_jig: 'SJ',
  single_jig: 'Hop',
  treble_jig: 'TJ',
  hornpipe: 'HP',
  st_patricks_day: 'TS',
  trad_set: 'TS',
  treble_reel: 'TR'
}

const CHAMPIONSHIP_DIGITS: Record<ChampionshipKey, string> = { prelim: '5', open: '6' }

function danceCode(danceKey: string): string {
  return (
    DANCE_CODES[danceKey] ??
    danceKey
      .split('_')
      .map((word) => word.charAt(0).toUpperCase())
      .join('')
  )
}

/** 'U10' → '10', 'O18' → '18a' (and over), anything else unchanged. */
function ageCode(ageKey: string): string {
  const under = /^U(\d+)$/.exec(ageKey)
  if (under) return under[1].padStart(2, '0')
  const over = /^O(\d+)$/.exec(ageKey)
  if (over) return `${over[1]}a`
  return ageKey
}

/**
 * The usual feis competition code: level rank + age + dance for solos (AB U10 Reel → 210R),
 * 5 + age for prelim and 6 + age for open. Specials get no code; the organiser sets one.
 */
export function competitionCode(
  comp: {
    competition_type: string
    level_key: string | null
    age_group_key: string | null
    dance_key: string | null
    championship_key: ChampionshipKey | null
  },
  levels: Level[]
): string | null {
  if (!comp.age_group_key) return null
  const age = ageCode(comp.age_group_key)

  if (comp.competition_type === 'championship' && comp.championship_key) {
    return `${CHAMPIONSHIP_DIGITS[comp.championship_key]}${age}`
  }

  if (comp.competition_type === 'solo' && comp.level_key && comp.dance_key) {
    const level = levels.find((l) => l.key === comp.level_key)
    if (!level) return null
    return `${level.rank}${age}${danceCode(comp.dance_key)}`
  }

  return null
}

/**
 * Expands a syllabus template + organiser selections into frozen competition rows.
 *
 * Pure function — no side effects, no DB calls.
 * Each output row contains ALL eligibility data inline (frozen snapshot).
 * Template edits after expansion have no effect on existing rows.
 */
export function expandSyllabus(
  templateData: TemplateData,
  selection: SyllabusSelection
): ExpandedCompetition[] {
  const results: ExpandedCompetition[] = []
  let sortOrder = 0

  // Build lookup maps from template data
  const ageMap = new Map(templateData.age_groups.map((a) => [a.key, a]))
  const levelMap = new Map(templateData.levels.map((l) => [l.key, l]))
  const danceMap = new Map(templateData.dances.map((d) => [d.key, d]))
  const champMap = new Map(templateData.championship_types.map((c) => [c.key, c]))
  const specialMap = new Map(templateData.specials.map((s) => [s.key, s]))

  // 1. Solos: age × level × dance (only if all three keys match template data)
  for (const ageKey of selection.enabled_age_groups) {
    const age = ageMap.get(ageKey)
    if (!age) continue

    for (const levelKey of selection.enabled_levels) {
      const level = levelMap.get(levelKey)
      if (!level) continue

      for (const danceKey of selection.enabled_dances) {
        const dance = danceMap.get(danceKey)
        if (!dance) continue
        if (selection.level_dances && !selection.level_dances[levelKey]?.includes(danceKey)) continue

        results.push({
          age_group_key: age.key,
          age_group_label: age.label,
          age_max_jan1: age.max_age_jan1 ?? null,
          age_min_jan1: age.min_age_jan1 ?? null,
          level_key: level.key,
          level_label: level.label,
          dance_key: dance.key,
          dance_label: dance.label,
          competition_type: 'solo',
          championship_key: null,
          fee_category: 'solo',
          display_name: `${age.key} ${level.label} ${dance.label}`,
          display_code: competitionCode(
            {
              competition_type: 'solo',
              level_key: level.key,
              age_group_key: age.key,
              dance_key: dance.key,
              championship_key: null
            },
            templateData.levels
          ),
          sort_order: sortOrder++
        })
      }
    }
  }

  // 2. Championships: for each enabled championship type × age group
  const champConfigs: { enabled: boolean; ageGroups: string[]; key: ChampionshipKey }[] = [
    { enabled: selection.enable_prelim, ageGroups: selection.prelim_age_groups, key: 'prelim' },
    { enabled: selection.enable_open, ageGroups: selection.open_age_groups, key: 'open' }
  ]

  for (const config of champConfigs) {
    if (!config.enabled) continue

    const champType = champMap.get(config.key)
    if (!champType) continue

    for (const ageKey of config.ageGroups) {
      const age = ageMap.get(ageKey)
      if (!age) continue

      results.push({
        age_group_key: age.key,
        age_group_label: age.label,
        age_max_jan1: age.max_age_jan1 ?? null,
        age_min_jan1: age.min_age_jan1 ?? null,
        level_key: champType.eligible_levels[0] ?? null,
        level_label: null,
        dance_key: null,
        dance_label: null,
        competition_type: 'championship',
        championship_key: config.key,
        fee_category: champType.fee_category as FeeCategoryType,
        display_name: `${age.key} ${champType.label}`,
        display_code: competitionCode(
          {
            competition_type: 'championship',
            level_key: null,
            age_group_key: age.key,
            dance_key: null,
            championship_key: config.key
          },
          templateData.levels
        ),
        sort_order: sortOrder++
      })
    }
  }

  // 3. Specials: each enabled special → one row, cross-age (null age_group)
  for (const specialKey of selection.enable_specials) {
    const special = specialMap.get(specialKey)
    if (!special) continue

    results.push({
      age_group_key: null,
      age_group_label: null,
      age_max_jan1: null,
      age_min_jan1: null,
      level_key: null,
      level_label: null,
      dance_key: special.key,
      dance_label: special.label,
      competition_type: 'special',
      championship_key: null,
      fee_category: 'solo',
      display_name: special.label,
      display_code: null,
      sort_order: sortOrder++
    })
  }

  return results
}
