import { describe, it, expect } from 'vitest'
import { suggestMerges } from '@/lib/engine/merge-suggestions'
import type { AgeGroup, FeisCompetition } from '@/lib/types/feis-listing'

const AGE_GROUPS: AgeGroup[] = [
  { key: 'U8', label: 'Under 8', max_age_jan1: 7 },
  { key: 'U9', label: 'Under 9', max_age_jan1: 8 },
  { key: 'U10', label: 'Under 10', max_age_jan1: 9 },
  { key: 'U11', label: 'Under 11', max_age_jan1: 10 },
  { key: 'U12', label: 'Under 12', max_age_jan1: 11 },
  { key: 'U13', label: 'Under 13', max_age_jan1: 12 }
]

const AGE_LABELS = new Map(AGE_GROUPS.map((a) => [a.key, a.label]))

function makeCompetition(
  ageKey: string,
  overrides: Partial<FeisCompetition> = {}
): FeisCompetition {
  const levelKey = overrides.level_key ?? 'NOV'
  const danceKey = overrides.dance_key ?? 'reel'
  return {
    id: `${levelKey}-${danceKey}-${ageKey}`,
    feis_listing_id: 'feis-1',
    age_group_key: ageKey,
    age_group_label: AGE_LABELS.get(ageKey) ?? null,
    age_max_jan1: null,
    age_min_jan1: null,
    level_key: levelKey,
    level_label: 'Novice',
    dance_key: danceKey,
    dance_label: 'Reel',
    competition_type: 'solo',
    championship_key: null,
    fee_category: 'solo',
    fee_cents: null,
    exclude_from_family_cap: false,
    grades_only: false,
    display_code: null,
    display_name: `${ageKey} Novice Reel`,
    capacity_cap: null,
    enabled: true,
    ...overrides
  }
}

/** Builds one NOV reel lane from [ageKey, entries] pairs. */
function lane(counts: [string, number][], overrides: Partial<FeisCompetition> = {}) {
  const competitions = counts.map(([age]) => makeCompetition(age, overrides))
  const entryCounts: Record<string, number> = {}
  counts.forEach(([, n], i) => {
    entryCounts[competitions[i].id] = n
  })
  return { competitions, entryCounts }
}

const OPTIONS = { minEntries: 5, ageGroups: AGE_GROUPS }

describe('suggestMerges', () => {
  it('merges two small adjacent competitions, competing as the older age group', () => {
    const { competitions, entryCounts } = lane([
      ['U10', 3],
      ['U11', 3]
    ])
    const result = suggestMerges(competitions, entryCounts, OPTIONS)

    expect(result.merges).toEqual([
      {
        competitionIds: ['NOV-reel-U10', 'NOV-reel-U11'],
        ageGroupKeys: ['U10', 'U11'],
        levelKey: 'NOV',
        danceKey: 'reel',
        totalEntries: 6,
        label: 'U10 + U11',
        competesAsAgeGroupKey: 'U11',
        competesAsAgeGroupLabel: 'Under 11',
        belowMinimum: false
      }
    ])
    expect(result.unmergeable).toEqual([])
    expect(result.empty).toEqual([])
  })

  it('absorbs a run of three until the minimum is reached', () => {
    const { competitions, entryCounts } = lane([
      ['U8', 1],
      ['U9', 2],
      ['U10', 2]
    ])
    const result = suggestMerges(competitions, entryCounts, OPTIONS)

    expect(result.merges).toHaveLength(1)
    expect(result.merges[0].label).toBe('U8 + U9 + U10')
    expect(result.merges[0].totalEntries).toBe(5)
    expect(result.merges[0].competesAsAgeGroupKey).toBe('U10')
    expect(result.merges[0].belowMinimum).toBe(false)
  })

  it('splits a long run into several groups once each reaches the minimum', () => {
    const { competitions, entryCounts } = lane([
      ['U8', 3],
      ['U9', 2],
      ['U10', 4],
      ['U11', 4]
    ])
    const result = suggestMerges(competitions, entryCounts, OPTIONS)

    expect(result.merges.map((m) => m.label)).toEqual(['U8 + U9', 'U10 + U11'])
    expect(result.merges.map((m) => m.totalEntries)).toEqual([5, 8])
  })

  it('never merges large competitions; a lone small one between large neighbours is unmergeable', () => {
    const { competitions, entryCounts } = lane([
      ['U9', 10],
      ['U10', 2],
      ['U11', 5]
    ])
    const result = suggestMerges(competitions, entryCounts, OPTIONS)

    expect(result.merges).toEqual([])
    expect(result.unmergeable).toEqual([{ competitionId: 'NOV-reel-U10', entries: 2 }])
  })

  it('does not merge small competitions separated by a large one', () => {
    const { competitions, entryCounts } = lane([
      ['U9', 2],
      ['U10', 8],
      ['U11', 2]
    ])
    const result = suggestMerges(competitions, entryCounts, OPTIONS)

    expect(result.merges).toEqual([])
    expect(result.unmergeable.map((u) => u.competitionId)).toEqual(['NOV-reel-U9', 'NOV-reel-U11'])
  })

  it('does not merge non-adjacent age groups when the in-between competition is not offered', () => {
    const { competitions, entryCounts } = lane([
      ['U9', 2],
      ['U11', 2]
    ])
    const result = suggestMerges(competitions, entryCounts, OPTIONS)

    expect(result.merges).toEqual([])
    expect(result.unmergeable).toHaveLength(2)
  })

  it('does not merge across different dances or levels', () => {
    const reel = makeCompetition('U10', { dance_key: 'reel' })
    const slip = makeCompetition('U11', { dance_key: 'slip_jig' })
    const beginner = makeCompetition('U11', { level_key: 'BG' })
    const result = suggestMerges(
      [reel, slip, beginner],
      { [reel.id]: 2, [slip.id]: 2, [beginner.id]: 2 },
      OPTIONS
    )

    expect(result.merges).toEqual([])
    expect(result.unmergeable).toHaveLength(3)
  })

  it('keeps separate lanes independent', () => {
    const reel = lane([
      ['U10', 2],
      ['U11', 3]
    ])
    const jig = lane(
      [
        ['U10', 1],
        ['U11', 1]
      ],
      { dance_key: 'light_jig' }
    )
    const result = suggestMerges(
      [...reel.competitions, ...jig.competitions],
      { ...reel.entryCounts, ...jig.entryCounts },
      OPTIONS
    )

    expect(result.merges.map((m) => m.competitionIds)).toEqual([
      ['NOV-light_jig-U10', 'NOV-light_jig-U11'],
      ['NOV-reel-U10', 'NOV-reel-U11']
    ])
  })

  it('excludes championship, special and disabled competitions', () => {
    const prelims = [
      makeCompetition('U10', {
        id: 'prelim-U10',
        competition_type: 'championship',
        championship_key: 'prelim',
        dance_key: null,
        fee_category: 'prelim_champ'
      }),
      makeCompetition('U11', {
        id: 'prelim-U11',
        competition_type: 'championship',
        championship_key: 'prelim',
        dance_key: null,
        fee_category: 'prelim_champ'
      })
    ]
    const disabled = [
      makeCompetition('U12', { enabled: false }),
      makeCompetition('U13', { enabled: false })
    ]
    const special = makeCompetition('U10', { id: 'ceili', competition_type: 'special' })
    const all = [...prelims, ...disabled, special]
    const counts = Object.fromEntries(all.map((c) => [c.id, 1]))

    const result = suggestMerges(all, counts, OPTIONS)

    expect(result).toEqual({ merges: [], unmergeable: [], empty: [] })
  })

  it('folds a trailing short group back into the previous group', () => {
    const { competitions, entryCounts } = lane([
      ['U8', 3],
      ['U9', 3],
      ['U10', 1]
    ])
    const result = suggestMerges(competitions, entryCounts, OPTIONS)

    expect(result.merges).toHaveLength(1)
    expect(result.merges[0].label).toBe('U8 + U9 + U10')
    expect(result.merges[0].totalEntries).toBe(7)
    expect(result.merges[0].belowMinimum).toBe(false)
  })

  it('still suggests a merge marked belowMinimum when the whole run is short', () => {
    const { competitions, entryCounts } = lane([
      ['U10', 1],
      ['U11', 2]
    ])
    const result = suggestMerges(competitions, entryCounts, OPTIONS)

    expect(result.merges).toHaveLength(1)
    expect(result.merges[0].totalEntries).toBe(3)
    expect(result.merges[0].belowMinimum).toBe(true)
  })

  it('lists empty competitions separately and never merges them', () => {
    const { competitions, entryCounts } = lane([
      ['U9', 0],
      ['U10', 2],
      ['U11', 0],
      ['U12', 2]
    ])
    const result = suggestMerges(competitions, entryCounts, OPTIONS)

    expect(result.empty).toEqual(['NOV-reel-U9', 'NOV-reel-U11'])
    expect(result.merges).toEqual([])
    expect(result.unmergeable.map((u) => u.competitionId)).toEqual(['NOV-reel-U10', 'NOV-reel-U12'])
  })

  it('treats a competition missing from entryCounts as empty', () => {
    const competition = makeCompetition('U10')
    const result = suggestMerges([competition], {}, OPTIONS)

    expect(result.empty).toEqual([competition.id])
  })

  it('uses the ageGroups order, not label parsing, for adjacency', () => {
    const ageGroups: AgeGroup[] = [
      { key: 'U18', label: 'Under 18', max_age_jan1: 17 },
      { key: 'O18', label: '18 & Over', min_age_jan1: 18 }
    ]
    const { competitions, entryCounts } = lane([
      ['O18', 2],
      ['U18', 2]
    ])
    const result = suggestMerges(competitions, entryCounts, { minEntries: 5, ageGroups })

    expect(result.merges[0].label).toBe('U18 + O18')
    expect(result.merges[0].competesAsAgeGroupKey).toBe('O18')
  })

  it('reports small competitions with an unknown age group as unmergeable', () => {
    const { competitions, entryCounts } = lane([
      ['U10', 2],
      ['U99', 2]
    ])
    const result = suggestMerges(competitions, entryCounts, OPTIONS)

    expect(result.merges).toEqual([])
    expect(result.unmergeable.map((u) => u.competitionId).sort()).toEqual([
      'NOV-reel-U10',
      'NOV-reel-U99'
    ])
  })

  it('produces identical output regardless of input order', () => {
    const reel = lane([
      ['U8', 1],
      ['U9', 1],
      ['U10', 0],
      ['U11', 2],
      ['U12', 9],
      ['U13', 2]
    ])
    const jig = lane(
      [
        ['U8', 2],
        ['U9', 4]
      ],
      { dance_key: 'light_jig', level_key: 'BG' }
    )
    const all = [...reel.competitions, ...jig.competitions]
    const counts = { ...reel.entryCounts, ...jig.entryCounts }

    const forward = suggestMerges(all, counts, OPTIONS)
    const reversed = suggestMerges([...all].reverse(), counts, OPTIONS)

    expect(reversed).toEqual(forward)
    expect(forward.merges.map((m) => m.label)).toEqual(['U8 + U9', 'U8 + U9'])
    expect(forward.merges.map((m) => m.levelKey)).toEqual(['BG', 'NOV'])
  })

  it('rejects an invalid minEntries', () => {
    expect(() => suggestMerges([], {}, { minEntries: 0, ageGroups: AGE_GROUPS })).toThrow(
      RangeError
    )
    expect(() => suggestMerges([], {}, { minEntries: 2.5, ageGroups: AGE_GROUPS })).toThrow(
      RangeError
    )
  })
})
