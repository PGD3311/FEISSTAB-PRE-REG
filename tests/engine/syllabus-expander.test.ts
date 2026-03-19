import { describe, it, expect } from 'vitest'
import { expandSyllabus } from '@/lib/engine/syllabus-expander'
import type { TemplateData, SyllabusSelection } from '@/lib/types/feis-listing'

const TEMPLATE: TemplateData = {
  age_groups: [
    { key: 'U8', label: 'Under 8', max_age_jan1: 7 },
    { key: 'U9', label: 'Under 9', max_age_jan1: 8 },
    { key: 'U10', label: 'Under 10', max_age_jan1: 9 }
  ],
  levels: [
    { key: 'BG', label: 'Beginner', rank: 1 },
    { key: 'AB', label: 'Advanced Beginner', rank: 2 }
  ],
  dances: [
    { key: 'reel', label: 'Reel', type: 'light' },
    { key: 'light_jig', label: 'Light Jig', type: 'light' }
  ],
  championship_types: [
    {
      key: 'prelim',
      label: 'Preliminary Championship',
      eligible_levels: ['PW'],
      fee_category: 'prelim_champ'
    }
  ],
  specials: [
    { key: 'ceili', label: 'Ceili (Team)', type: 'team' }
  ]
}

function fullSelection(): SyllabusSelection {
  return {
    enabled_age_groups: ['U8', 'U9', 'U10'],
    enabled_levels: ['BG', 'AB'],
    enabled_dances: ['reel', 'light_jig'],
    enable_prelim: false,
    prelim_age_groups: [],
    enable_open: false,
    open_age_groups: [],
    enable_specials: []
  }
}

describe('expandSyllabus', () => {
  it('full selection: 3 ages × 2 levels × 2 dances = 12 solo competitions', () => {
    const result = expandSyllabus(TEMPLATE, fullSelection())
    expect(result).toHaveLength(12)
    expect(result.every((r) => r.competition_type === 'solo')).toBe(true)
  })

  it('display name: U8 + BG + reel → "Under 8 Beginner Reel"', () => {
    const selection = fullSelection()
    selection.enabled_age_groups = ['U8']
    selection.enabled_levels = ['BG']
    selection.enabled_dances = ['reel']
    const result = expandSyllabus(TEMPLATE, selection)
    expect(result).toHaveLength(1)
    expect(result[0].display_name).toBe('Under 8 Beginner Reel')
  })

  it('frozen eligibility: all fields set correctly for solo', () => {
    const selection = fullSelection()
    selection.enabled_age_groups = ['U8']
    selection.enabled_levels = ['BG']
    selection.enabled_dances = ['reel']
    const result = expandSyllabus(TEMPLATE, selection)
    const row = result[0]
    expect(row.age_group_key).toBe('U8')
    expect(row.age_group_label).toBe('Under 8')
    expect(row.age_max_jan1).toBe(7)
    expect(row.age_min_jan1).toBeNull()
    expect(row.level_key).toBe('BG')
    expect(row.level_label).toBe('Beginner')
    expect(row.dance_key).toBe('reel')
    expect(row.dance_label).toBe('Reel')
    expect(row.competition_type).toBe('solo')
    expect(row.championship_key).toBeNull()
    expect(row.fee_category).toBe('solo')
  })

  it('partial selection: only U8 → 4 results (1 age × 2 levels × 2 dances)', () => {
    const selection = fullSelection()
    selection.enabled_age_groups = ['U8']
    const result = expandSyllabus(TEMPLATE, selection)
    expect(result).toHaveLength(4)
  })

  it('championship rows: enable_prelim + U10 → 1 championship row', () => {
    const selection = fullSelection()
    selection.enabled_age_groups = []
    selection.enabled_levels = []
    selection.enabled_dances = []
    selection.enable_prelim = true
    selection.prelim_age_groups = ['U10']
    const result = expandSyllabus(TEMPLATE, selection)
    expect(result).toHaveLength(1)
    const row = result[0]
    expect(row.competition_type).toBe('championship')
    expect(row.championship_key).toBe('prelim')
    expect(row.dance_key).toBeNull()
    expect(row.dance_label).toBeNull()
    expect(row.fee_category).toBe('prelim_champ')
    expect(row.display_name).toBe('Under 10 Preliminary Championship')
    expect(row.age_group_key).toBe('U10')
    expect(row.age_group_label).toBe('Under 10')
    expect(row.age_max_jan1).toBe(9)
    expect(row.level_key).toBe('PW')
    expect(row.level_label).toBeNull()
  })

  it('special rows: enable ceili → 1 special row with null age_group', () => {
    const selection = fullSelection()
    selection.enabled_age_groups = []
    selection.enabled_levels = []
    selection.enabled_dances = []
    selection.enable_specials = ['ceili']
    const result = expandSyllabus(TEMPLATE, selection)
    expect(result).toHaveLength(1)
    const row = result[0]
    expect(row.age_group_key).toBeNull()
    expect(row.age_group_label).toBeNull()
    expect(row.age_max_jan1).toBeNull()
    expect(row.age_min_jan1).toBeNull()
    expect(row.level_key).toBeNull()
    expect(row.level_label).toBeNull()
    expect(row.dance_key).toBe('ceili')
    expect(row.dance_label).toBe('Ceili (Team)')
    expect(row.competition_type).toBe('special')
    expect(row.fee_category).toBe('solo')
    expect(row.display_name).toBe('Ceili (Team)')
  })

  it('empty selection → 0 results', () => {
    const selection: SyllabusSelection = {
      enabled_age_groups: [],
      enabled_levels: [],
      enabled_dances: [],
      enable_prelim: false,
      prelim_age_groups: [],
      enable_open: false,
      open_age_groups: [],
      enable_specials: []
    }
    const result = expandSyllabus(TEMPLATE, selection)
    expect(result).toHaveLength(0)
  })

  it('deterministic sort order: values are strictly increasing', () => {
    const result = expandSyllabus(TEMPLATE, fullSelection())
    for (let i = 1; i < result.length; i++) {
      expect(result[i].sort_order).toBeGreaterThan(result[i - 1].sort_order)
    }
  })

  it('combined: solos + championship + special = correct total', () => {
    const selection: SyllabusSelection = {
      enabled_age_groups: ['U8'],
      enabled_levels: ['BG'],
      enabled_dances: ['reel'],
      enable_prelim: true,
      prelim_age_groups: ['U10'],
      enable_open: false,
      open_age_groups: [],
      enable_specials: ['ceili']
    }
    const result = expandSyllabus(TEMPLATE, selection)
    expect(result).toHaveLength(3)
    expect(result[0].competition_type).toBe('solo')
    expect(result[1].competition_type).toBe('championship')
    expect(result[2].competition_type).toBe('special')
  })

  it('unknown keys → 0 results (gracefully ignores)', () => {
    const selection: SyllabusSelection = {
      enabled_age_groups: ['UNKNOWN_AGE'],
      enabled_levels: ['UNKNOWN_LEVEL'],
      enabled_dances: ['UNKNOWN_DANCE'],
      enable_prelim: false,
      prelim_age_groups: [],
      enable_open: false,
      open_age_groups: [],
      enable_specials: ['UNKNOWN_SPECIAL']
    }
    const result = expandSyllabus(TEMPLATE, selection)
    expect(result).toHaveLength(0)
  })
})
