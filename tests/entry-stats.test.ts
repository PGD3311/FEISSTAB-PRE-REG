import { describe, it, expect } from 'vitest'
import { levelOf, summariseEntries } from '@/lib/entry-stats'
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
  comp('bgR', { level_label: 'Beginner' }),
  comp('novR', { level_label: 'Novice' }),
  comp('novLJ', { level_label: 'Novice' }),
  comp('pc12', { competition_type: 'championship', championship_key: 'prelim' }),
  comp('sp', { competition_type: 'special' })
]

describe('levelOf', () => {
  it('names solos by level, championships by type, and lumps the rest', () => {
    expect(levelOf(comps[1])).toBe('Novice')
    expect(levelOf(comps[3])).toBe('Preliminary championship')
    expect(
      levelOf(comp('oc', { competition_type: 'championship', championship_key: 'open' }))
    ).toBe('Open championship')
    expect(levelOf(comps[4])).toBe('Specials and other')
  })
})

describe('summariseEntries', () => {
  const entries = [
    { dancerId: 'mary', competitionId: 'novR', status: 'paid' },
    { dancerId: 'mary', competitionId: 'novLJ', status: 'paid' },
    { dancerId: 'sean', competitionId: 'novR', status: 'paid' },
    { dancerId: 'aoife', competitionId: 'pc12', status: 'paid' },
    { dancerId: 'liam', competitionId: 'bgR', status: 'pending_payment' },
    { dancerId: 'nora', competitionId: 'novR', status: 'expired' }
  ]

  it('counts only paid entries and dancers', () => {
    const stats = summariseEntries(entries, comps)
    expect(stats.paidEntries).toBe(4)
    expect(stats.paidDancers).toBe(3)
  })

  it('lists the paid dancers in each competition', () => {
    const stats = summariseEntries(entries, comps)
    expect(stats.dancersByCompetition.get('novR')).toEqual(['mary', 'sean'])
    expect(stats.dancersByCompetition.has('bgR')).toBe(false)
  })

  it('counts dancers once per level, in syllabus order, skipping empty levels', () => {
    const stats = summariseEntries(entries, comps)
    expect(stats.byLevel).toEqual([
      { label: 'Novice', dancers: 2, entries: 3 },
      { label: 'Preliminary championship', dancers: 1, entries: 1 }
    ])
  })
})
