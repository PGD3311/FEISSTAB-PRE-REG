import { describe, it, expect } from 'vitest'
import {
  getEligibleCompetitions,
  calculateAgeOnDate
} from '@/lib/engine/eligibility'
import type {
  DancerProfile,
  FeisCompetition,
  Level
} from '@/lib/types/feis-listing'

function makeCompetition(overrides: Partial<FeisCompetition> = {}): FeisCompetition {
  return {
    id: 'comp-1',
    feis_listing_id: 'feis-1',
    age_group_key: 'U12',
    age_group_label: 'Under 12',
    age_max_jan1: 11,
    age_min_jan1: null,
    level_key: 'NOV',
    level_label: 'Novice',
    dance_key: 'reel',
    dance_label: 'Reel',
    competition_type: 'solo',
    championship_key: null,
    fee_category: 'solo',
    display_name: 'U12 Novice Reel',
    capacity_cap: null,
    enabled: true,
    ...overrides
  }
}

const LEVELS: Level[] = [
  { key: 'BG', label: 'Beginner', rank: 1 },
  { key: 'AB', label: 'Advanced Beginner', rank: 2 },
  { key: 'NOV', label: 'Novice', rank: 3 },
  { key: 'PW', label: 'Prizewinner', rank: 4 },
]

describe('calculateAgeOnDate', () => {
  it('calculates age for child born March 15 2014, on Jan 1 2026', () => {
    expect(calculateAgeOnDate(new Date('2014-03-15'), new Date('2026-01-01'))).toBe(11)
  })
  it('calculates age for child born Jan 1 2014, on Jan 1 2026 (exact birthday)', () => {
    expect(calculateAgeOnDate(new Date('2014-01-01'), new Date('2026-01-01'))).toBe(12)
  })
  it('calculates age for child born Dec 31 2014, on Jan 1 2026', () => {
    expect(calculateAgeOnDate(new Date('2014-12-31'), new Date('2026-01-01'))).toBe(11)
  })
  it('calculates age for child born Feb 29 2016 (leap year), on Jan 1 2026', () => {
    expect(calculateAgeOnDate(new Date('2016-02-29'), new Date('2026-01-01'))).toBe(9)
  })
  it('returns -1 for baby born after reference date in same year', () => {
    expect(calculateAgeOnDate(new Date('2026-06-15'), new Date('2026-01-01'))).toBe(-1)
  })
  it('handles same date as DOB (age is 0)', () => {
    expect(calculateAgeOnDate(new Date('2020-06-15'), new Date('2020-06-15'))).toBe(0)
  })
})

describe('getEligibleCompetitions', () => {
  const ageCutoff = new Date('2026-01-01')
  const noviceDancer: DancerProfile = {
    dob: new Date('2014-03-15'),
    gender: 'female',
    championshipStatus: 'none',
    danceLevels: { reel: 'NOV', slip_jig: 'NOV', treble_jig: 'NOV' }
  }

  it('marks a solo competition as eligible when age and level match', () => {
    const result = getEligibleCompetitions(noviceDancer, [makeCompetition()], ageCutoff, LEVELS)
    expect(result).toHaveLength(1)
    expect(result[0].eligible).toBe(true)
    expect(result[0].reason).toContain('match')
  })

  it('marks a solo competition as ineligible when dancer level does not match', () => {
    const result = getEligibleCompetitions(noviceDancer, [makeCompetition({ level_key: 'PW' })], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(false)
  })

  it('uses per-dance level (not a single default level)', () => {
    const dancer: DancerProfile = {
      dob: new Date('2014-03-15'),
      gender: 'female',
      championshipStatus: 'none',
      danceLevels: { reel: 'NOV', slip_jig: 'AB' }
    }
    const comps = [
      makeCompetition({ id: 'c1', dance_key: 'reel', level_key: 'NOV' }),
      makeCompetition({ id: 'c2', dance_key: 'slip_jig', level_key: 'NOV' }),
    ]
    const result = getEligibleCompetitions(dancer, comps, ageCutoff, LEVELS)
    expect(result.find(r => r.competition.id === 'c1')!.eligible).toBe(true)
    expect(result.find(r => r.competition.id === 'c2')!.eligible).toBe(false)
  })

  it('marks solo as ineligible when age does not match (too old)', () => {
    const olderDancer: DancerProfile = {
      dob: new Date('2013-03-15'), gender: 'female', championshipStatus: 'none', danceLevels: { reel: 'NOV' }
    }
    const result = getEligibleCompetitions(olderDancer, [makeCompetition()], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(false)
    expect(result[0].reason).toContain('age')
  })

  it('handles O18 age group (min_age_jan1)', () => {
    const adultDancer: DancerProfile = {
      dob: new Date('2005-06-01'), gender: 'female', championshipStatus: 'none', danceLevels: { reel: 'NOV' }
    }
    const comp = makeCompetition({ age_group_key: 'O18', age_max_jan1: null, age_min_jan1: 18 })
    const result = getEligibleCompetitions(adultDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(true)
  })

  it('handles O18 age group — too young', () => {
    const youngDancer: DancerProfile = {
      dob: new Date('2010-06-01'), gender: 'female', championshipStatus: 'none', danceLevels: { reel: 'NOV' }
    }
    const comp = makeCompetition({ age_group_key: 'O18', age_max_jan1: null, age_min_jan1: 18 })
    const result = getEligibleCompetitions(youngDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(false)
  })

  it('marks prelim championship as eligible when dancer has prelim status', () => {
    const prelimDancer: DancerProfile = {
      dob: new Date('2014-03-15'), gender: 'female', championshipStatus: 'prelim', danceLevels: { reel: 'PW' }
    }
    const comp = makeCompetition({ competition_type: 'championship', championship_key: 'prelim', level_key: null, dance_key: null, fee_category: 'prelim_champ' })
    const result = getEligibleCompetitions(prelimDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(true)
  })

  it('marks open championship as eligible when dancer has open status', () => {
    const openDancer: DancerProfile = {
      dob: new Date('2014-03-15'), gender: 'female', championshipStatus: 'open', danceLevels: { reel: 'PW' }
    }
    const comp = makeCompetition({ competition_type: 'championship', championship_key: 'open', level_key: null, dance_key: null, fee_category: 'open_champ' })
    const result = getEligibleCompetitions(openDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(true)
  })

  it('marks prelim championship as eligible when dancer has open status (open can enter prelim)', () => {
    const openDancer: DancerProfile = {
      dob: new Date('2014-03-15'), gender: 'female', championshipStatus: 'open', danceLevels: { reel: 'PW' }
    }
    const comp = makeCompetition({ competition_type: 'championship', championship_key: 'prelim', level_key: null, dance_key: null, fee_category: 'prelim_champ' })
    const result = getEligibleCompetitions(openDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(true)
  })

  it('marks open championship as ineligible for prelim dancer', () => {
    const prelimDancer: DancerProfile = {
      dob: new Date('2014-03-15'), gender: 'female', championshipStatus: 'prelim', danceLevels: { reel: 'PW' }
    }
    const comp = makeCompetition({ competition_type: 'championship', championship_key: 'open', level_key: null, dance_key: null, fee_category: 'open_champ' })
    const result = getEligibleCompetitions(prelimDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(false)
    expect(result[0].reason).toContain('championship')
  })

  it('marks championship as ineligible for none status dancer', () => {
    const comp = makeCompetition({ competition_type: 'championship', championship_key: 'prelim', level_key: null, dance_key: null, fee_category: 'prelim_champ' })
    const result = getEligibleCompetitions(noviceDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(false)
  })

  it('marks specials as eligible when age matches', () => {
    const comp = makeCompetition({ competition_type: 'special', level_key: null, dance_key: null })
    const result = getEligibleCompetitions(noviceDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(true)
  })

  it('marks cross-age specials as always eligible (both age fields null)', () => {
    const comp = makeCompetition({ competition_type: 'special', age_group_key: null, age_group_label: null, age_max_jan1: null, age_min_jan1: null, level_key: null, dance_key: null })
    const result = getEligibleCompetitions(noviceDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(true)
  })

  it('marks custom competitions as always eligible', () => {
    const comp = makeCompetition({ competition_type: 'custom', age_group_key: null, age_group_label: null, age_max_jan1: null, age_min_jan1: null, level_key: null, dance_key: null })
    const result = getEligibleCompetitions(noviceDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(true)
  })

  it('filters out disabled competitions', () => {
    const comps = [
      makeCompetition({ id: 'c1', enabled: true }),
      makeCompetition({ id: 'c2', enabled: false })
    ]
    const result = getEligibleCompetitions(noviceDancer, comps, ageCutoff, LEVELS)
    expect(result).toHaveLength(1)
    expect(result[0].competition.id).toBe('c1')
  })

  it('handles empty competitions list', () => {
    expect(getEligibleCompetitions(noviceDancer, [], ageCutoff, LEVELS)).toEqual([])
  })

  it('handles dancer with no dance levels for the competition dance', () => {
    const comp = makeCompetition({ dance_key: 'hornpipe', level_key: 'NOV' })
    const result = getEligibleCompetitions(noviceDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(false)
    expect(result[0].reason).toContain('level')
  })

  it('handles empty dancer dance levels', () => {
    const dancer: DancerProfile = {
      dob: new Date('2014-03-15'), gender: 'female', championshipStatus: 'none', danceLevels: {}
    }
    const result = getEligibleCompetitions(dancer, [makeCompetition()], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(false)
  })

  it('processes multiple competitions at once', () => {
    const comps = [
      makeCompetition({ id: 'c1', dance_key: 'reel', level_key: 'NOV' }),
      makeCompetition({ id: 'c2', dance_key: 'slip_jig', level_key: 'NOV' }),
      makeCompetition({ id: 'c3', dance_key: 'reel', level_key: 'PW' }),
      makeCompetition({ id: 'c4', competition_type: 'special', level_key: null, dance_key: null }),
    ]
    const result = getEligibleCompetitions(noviceDancer, comps, ageCutoff, LEVELS)
    expect(result).toHaveLength(4)
    expect(result.find(r => r.competition.id === 'c1')!.eligible).toBe(true)
    expect(result.find(r => r.competition.id === 'c2')!.eligible).toBe(true)
    expect(result.find(r => r.competition.id === 'c3')!.eligible).toBe(false)
    expect(result.find(r => r.competition.id === 'c4')!.eligible).toBe(true)
  })
})
