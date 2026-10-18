import { describe, it, expect } from 'vitest'
import { ageRange, summariseSyllabus } from '@/lib/syllabus-summary'
import type { FeisCompetition } from '@/lib/types/feis-listing'

function comp(id: string, overrides: Partial<FeisCompetition>): FeisCompetition {
  return {
    id,
    feis_listing_id: 'f',
    age_group_key: null,
    age_group_label: null,
    age_max_jan1: null,
    age_min_jan1: null,
    level_key: null,
    level_label: null,
    dance_key: null,
    dance_label: null,
    competition_type: 'solo',
    championship_key: null,
    fee_category: 'solo',
    fee_cents: null,
    exclude_from_family_cap: false,
    grades_only: false,
    display_name: id,
    display_code: null,
    capacity_cap: null,
    enabled: true,
    ...overrides
  }
}

const comps = [
  comp('b6r', { level_label: 'Beginner', age_group_label: 'Under 6', dance_label: 'Reel' }),
  comp('b6lj', { level_label: 'Beginner', age_group_label: 'Under 6', dance_label: 'Light Jig' }),
  comp('b7r', { level_label: 'Beginner', age_group_label: 'Under 7', dance_label: 'Reel' }),
  comp('n7r', { level_label: 'Novice', age_group_label: 'Under 7', dance_label: 'Reel' }),
  comp('pc6', {
    competition_type: 'championship',
    championship_key: 'prelim',
    age_group_label: 'Under 6',
    display_name: 'U6 Preliminary Championship'
  }),
  comp('sp1', { competition_type: 'special', display_name: 'Treble Reel' }),
  comp('sp2', { competition_type: 'special', display_name: 'Ceili, Under 10' })
]

describe('summariseSyllabus', () => {
  it('folds competitions into one grid per level, in syllabus order', () => {
    const levels = summariseSyllabus(comps)
    expect(levels.map((l) => l.label)).toEqual([
      'Beginner',
      'Novice',
      'Preliminary championship',
      'Specials and other'
    ])
    const beginner = levels[0]
    expect(beginner.dances).toEqual(['Reel', 'Light Jig'])
    expect(beginner.rows).toEqual(['Under 6', 'Under 7'])
    expect(beginner.cells.get('Under 6|Light Jig')?.id).toBe('b6lj')
    expect(beginner.cells.has('Under 7|Light Jig')).toBe(false)
    expect(beginner.competitions).toHaveLength(3)
  })

  it('gives championships one row per age group and no dance columns', () => {
    const champ = summariseSyllabus(comps)[2]
    expect(champ.dances).toEqual([])
    expect(champ.rows).toEqual(['Under 6'])
    expect(champ.cells.get('Under 6|')?.id).toBe('pc6')
  })

  it('lists specials by name so two in the same age group stay apart', () => {
    const specials = summariseSyllabus(comps)[3]
    expect(specials.rows).toEqual(['Treble Reel', 'Ceili, Under 10'])
    expect(specials.ageGroups).toEqual([])
  })
})

describe('ageRange', () => {
  it('names the first and last age group', () => {
    expect(ageRange(['Under 6', 'Under 7', '21 & Over'])).toBe('Under 6 to 21 & Over')
    expect(ageRange(['Under 9'])).toBe('Under 9')
    expect(ageRange([])).toBeNull()
  })
})
