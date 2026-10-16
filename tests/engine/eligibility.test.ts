import { describe, it, expect } from 'vitest'
import { getEligibleCompetitions, calculateAgeOnDate } from '@/lib/engine/eligibility'
import type { DancerProfile, FeisCompetition, Level } from '@/lib/types/feis-listing'

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
    fee_cents: null,
    exclude_from_family_cap: false,
    grades_only: false,
    display_code: null,
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
  { key: 'PW', label: 'Prizewinner', rank: 4 }
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
    const result = getEligibleCompetitions(
      noviceDancer,
      [makeCompetition({ level_key: 'PW' })],
      ageCutoff,
      LEVELS
    )
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
      makeCompetition({ id: 'c2', dance_key: 'slip_jig', level_key: 'NOV' })
    ]
    const result = getEligibleCompetitions(dancer, comps, ageCutoff, LEVELS)
    expect(result.find((r) => r.competition.id === 'c1')!.eligible).toBe(true)
    expect(result.find((r) => r.competition.id === 'c2')!.eligible).toBe(false)
  })

  it('marks solo as ineligible when age does not match (too old)', () => {
    const olderDancer: DancerProfile = {
      dob: new Date('2013-03-15'),
      gender: 'female',
      championshipStatus: 'none',
      danceLevels: { reel: 'NOV' }
    }
    const result = getEligibleCompetitions(olderDancer, [makeCompetition()], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(false)
    expect(result[0].reason).toContain('age')
  })

  it('handles O18 age group (min_age_jan1)', () => {
    const adultDancer: DancerProfile = {
      dob: new Date('2005-06-01'),
      gender: 'female',
      championshipStatus: 'none',
      danceLevels: { reel: 'NOV' }
    }
    const comp = makeCompetition({ age_group_key: 'O18', age_max_jan1: null, age_min_jan1: 18 })
    const result = getEligibleCompetitions(adultDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(true)
  })

  it('handles O18 age group — too young', () => {
    const youngDancer: DancerProfile = {
      dob: new Date('2010-06-01'),
      gender: 'female',
      championshipStatus: 'none',
      danceLevels: { reel: 'NOV' }
    }
    const comp = makeCompetition({ age_group_key: 'O18', age_max_jan1: null, age_min_jan1: 18 })
    const result = getEligibleCompetitions(youngDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(false)
  })

  it('marks prelim championship as eligible when dancer has prelim status', () => {
    const prelimDancer: DancerProfile = {
      dob: new Date('2014-03-15'),
      gender: 'female',
      championshipStatus: 'prelim',
      danceLevels: { reel: 'PW' }
    }
    const comp = makeCompetition({
      competition_type: 'championship',
      championship_key: 'prelim',
      level_key: null,
      dance_key: null,
      fee_category: 'prelim_champ'
    })
    const result = getEligibleCompetitions(prelimDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(true)
  })

  it('marks open championship as eligible when dancer has open status', () => {
    const openDancer: DancerProfile = {
      dob: new Date('2014-03-15'),
      gender: 'female',
      championshipStatus: 'open',
      danceLevels: { reel: 'PW' }
    }
    const comp = makeCompetition({
      competition_type: 'championship',
      championship_key: 'open',
      level_key: null,
      dance_key: null,
      fee_category: 'open_champ'
    })
    const result = getEligibleCompetitions(openDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(true)
  })

  it('marks prelim championship as ineligible for an open champion (no going back)', () => {
    const openDancer: DancerProfile = { ...noviceDancer, championshipStatus: 'open' }
    const comps = [
      makeCompetition({
        competition_type: 'championship',
        championship_key: 'prelim',
        level_key: null,
        dance_key: null
      })
    ]
    const result = getEligibleCompetitions(openDancer, comps, ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(false)
  })

  it('marks open championship as ineligible for prelim dancer', () => {
    const prelimDancer: DancerProfile = {
      dob: new Date('2014-03-15'),
      gender: 'female',
      championshipStatus: 'prelim',
      danceLevels: { reel: 'PW' }
    }
    const comp = makeCompetition({
      competition_type: 'championship',
      championship_key: 'open',
      level_key: null,
      dance_key: null,
      fee_category: 'open_champ'
    })
    const result = getEligibleCompetitions(prelimDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(false)
    expect(result[0].reason).toContain('championship')
  })

  it('marks championship as ineligible for none status dancer', () => {
    const comp = makeCompetition({
      competition_type: 'championship',
      championship_key: 'prelim',
      level_key: null,
      dance_key: null,
      fee_category: 'prelim_champ'
    })
    const result = getEligibleCompetitions(noviceDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(false)
  })

  it('marks specials as eligible when age matches', () => {
    const comp = makeCompetition({ competition_type: 'special', level_key: null, dance_key: null })
    const result = getEligibleCompetitions(noviceDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(true)
  })

  it('marks cross-age specials as always eligible (both age fields null)', () => {
    const comp = makeCompetition({
      competition_type: 'special',
      age_group_key: null,
      age_group_label: null,
      age_max_jan1: null,
      age_min_jan1: null,
      level_key: null,
      dance_key: null
    })
    const result = getEligibleCompetitions(noviceDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(true)
  })

  it('marks custom competitions as always eligible', () => {
    const comp = makeCompetition({
      competition_type: 'custom',
      age_group_key: null,
      age_group_label: null,
      age_max_jan1: null,
      age_min_jan1: null,
      level_key: null,
      dance_key: null
    })
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
      dob: new Date('2014-03-15'),
      gender: 'female',
      championshipStatus: 'none',
      danceLevels: {}
    }
    const result = getEligibleCompetitions(dancer, [makeCompetition()], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(false)
  })

  it('processes multiple competitions at once', () => {
    const comps = [
      makeCompetition({ id: 'c1', dance_key: 'reel', level_key: 'NOV' }),
      makeCompetition({ id: 'c2', dance_key: 'slip_jig', level_key: 'NOV' }),
      makeCompetition({ id: 'c3', dance_key: 'reel', level_key: 'PW' }),
      makeCompetition({ id: 'c4', competition_type: 'special', level_key: null, dance_key: null })
    ]
    const result = getEligibleCompetitions(noviceDancer, comps, ageCutoff, LEVELS)
    expect(result).toHaveLength(4)
    expect(result.find((r) => r.competition.id === 'c1')!.eligible).toBe(true)
    expect(result.find((r) => r.competition.id === 'c2')!.eligible).toBe(true)
    expect(result.find((r) => r.competition.id === 'c3')!.eligible).toBe(false)
    expect(result.find((r) => r.competition.id === 'c4')!.eligible).toBe(true)
  })

  it('grades-only competitions (e.g. Future Champ) are open to grades dancers', () => {
    const comp = makeCompetition({
      competition_type: 'custom',
      level_key: null,
      dance_key: null,
      grades_only: true
    })
    const result = getEligibleCompetitions(noviceDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(true)
  })

  it('grades-only competitions are closed to prelim and open dancers', () => {
    const comp = makeCompetition({
      competition_type: 'custom',
      level_key: null,
      dance_key: null,
      grades_only: true
    })
    for (const championshipStatus of ['prelim', 'open'] as const) {
      const dancer: DancerProfile = { ...noviceDancer, championshipStatus }
      const result = getEligibleCompetitions(dancer, [comp], ageCutoff, LEVELS)
      expect(result[0].eligible).toBe(false)
      expect(result[0].reason).toContain('grades')
    }
  })

  it('a custom competition with an age group still checks age', () => {
    const comp = makeCompetition({
      competition_type: 'custom',
      level_key: null,
      dance_key: null,
      age_max_jan1: 7
    })
    const result = getEligibleCompetitions(noviceDancer, [comp], ageCutoff, LEVELS)
    expect(result[0].eligible).toBe(false)
  })

  describe('own age group only', () => {
    const u12 = makeCompetition({ id: 'u12', age_group_label: 'Under 12', age_max_jan1: 11 })
    const u13 = makeCompetition({ id: 'u13', age_group_label: 'Under 13', age_max_jan1: 12 })
    const u18 = makeCompetition({ id: 'u18', age_group_label: 'Under 18', age_max_jan1: 17 })

    it('shows an 11-year-old only the Under 12 group, not older ones', () => {
      const result = getEligibleCompetitions(noviceDancer, [u18, u13, u12], ageCutoff, LEVELS)
      const eligible = result.filter((r) => r.eligible).map((r) => r.competition.id)
      expect(eligible).toEqual(['u12'])
      expect(result.find((r) => r.competition.id === 'u13')?.reason).toBe(
        'Dances in their own age group (Under 12)'
      )
    })

    it('keeps one age group per dance and level, independently', () => {
      const jig12 = makeCompetition({ id: 'jig12', dance_key: 'light_jig', age_max_jan1: 11 })
      const jig13 = makeCompetition({ id: 'jig13', dance_key: 'light_jig', age_max_jan1: 12 })
      const kid: DancerProfile = { ...noviceDancer, danceLevels: { reel: 'NOV', light_jig: 'NOV' } }
      const eligible = getEligibleCompetitions(kid, [u12, u13, jig12, jig13], ageCutoff, LEVELS)
        .filter((r) => r.eligible)
        .map((r) => r.competition.id)
      expect(eligible.sort()).toEqual(['jig12', 'u12'])
    })

    it('moves up when there is no group for their exact age', () => {
      const result = getEligibleCompetitions(noviceDancer, [u13, u18], ageCutoff, LEVELS)
      expect(result.filter((r) => r.eligible).map((r) => r.competition.id)).toEqual(['u13'])
    })

    it('picks 21 & Over over 18 & Over for a 25-year-old', () => {
      const adult: DancerProfile = { ...noviceDancer, dob: new Date('2000-05-01') }
      const o18 = makeCompetition({ id: 'o18', age_max_jan1: null, age_min_jan1: 18 })
      const o21 = makeCompetition({ id: 'o21', age_max_jan1: null, age_min_jan1: 21 })
      const eligible = getEligibleCompetitions(adult, [o18, o21], ageCutoff, LEVELS)
        .filter((r) => r.eligible)
        .map((r) => r.competition.id)
      expect(eligible).toEqual(['o21'])
    })

    it('applies the same rule to championships', () => {
      const prelimDancer: DancerProfile = { ...noviceDancer, championshipStatus: 'prelim' }
      const champ = {
        competition_type: 'championship' as const,
        championship_key: 'prelim' as const,
        level_key: null,
        dance_key: null
      }
      const pc12 = makeCompetition({ id: 'pc12', age_max_jan1: 11, ...champ })
      const pc14 = makeCompetition({ id: 'pc14', age_max_jan1: 13, ...champ })
      const eligible = getEligibleCompetitions(prelimDancer, [pc14, pc12], ageCutoff, LEVELS)
        .filter((r) => r.eligible)
        .map((r) => r.competition.id)
      expect(eligible).toEqual(['pc12'])
    })

    it('leaves specials alone, since they can span ages on purpose', () => {
      const sp1 = makeCompetition({ id: 'sp1', competition_type: 'special', age_max_jan1: 11 })
      const sp2 = makeCompetition({ id: 'sp2', competition_type: 'special', age_max_jan1: 17 })
      const eligible = getEligibleCompetitions(noviceDancer, [sp1, sp2], ageCutoff, LEVELS).filter(
        (r) => r.eligible
      )
      expect(eligible).toHaveLength(2)
    })
  })
})
