import { describe, expect, it } from 'vitest'
import {
  ageCutoffDateFor,
  validateOrderRequest,
  type OrderDancer,
  type OrderRequest
} from '@/lib/engine/order-validation'
import type { FeisCompetition, Level } from '@/lib/types/feis-listing'

const NOW = new Date('2026-11-01T12:00:00Z')
const LEVELS: Level[] = [
  { key: 'BG', label: 'Beginner', rank: 1 },
  { key: 'AB', label: 'Advanced Beginner', rank: 2 },
  { key: 'NOV', label: 'Novice', rank: 3 },
  { key: 'PW', label: 'Prizewinner', rank: 4 },
]

function dancer(overrides: Partial<OrderDancer> = {}): OrderDancer {
  return {
    id: 'd1', household_id: 'h1', first_name: 'Aoife', last_name: 'Walsh', date_of_birth: '2018-05-01',
    gender: 'female', school_name: 'Scoil Rince', tcrg_name: null, championship_status: 'none', is_active: true,
    dance_levels: [{ dance_key: 'reel', level_key: 'NOV' }],
    ...overrides,
  }
}

function competition(overrides: Partial<FeisCompetition> = {}): FeisCompetition {
  return {
    id: 'c1', feis_listing_id: 'f1', age_group_key: 'U10', age_group_label: 'Under 10', age_max_jan1: 9,
    age_min_jan1: null, level_key: 'NOV', level_label: 'Novice', dance_key: 'reel', dance_label: 'Reel',
    competition_type: 'solo', championship_key: null, fee_category: 'solo', fee_cents: null,
    exclude_from_family_cap: false, grades_only: false, display_name: 'Novice Reel U10', display_code: '210R',
    capacity_cap: null, enabled: true,
    ...overrides,
  }
}

function request(overrides: Partial<OrderRequest> = {}): OrderRequest {
  return {
    now: NOW,
    householdId: 'h1',
    listing: {
      status: 'open', reg_opens_at: '2026-10-01T00:00:00Z', reg_closes_at: '2026-12-01T00:00:00Z',
      late_reg_closes_at: null, age_cutoff_date: '2027-01-01', feis_date: '2027-03-14', terms_url: null,
      levels: LEVELS,
    },
    dancers: [dancer()],
    competitions: [competition()],
    entries: [{ dancerId: 'd1', competitionId: 'c1' }],
    ...overrides,
  }
}

describe('validateOrderRequest', () => {
  it('accepts an eligible order and returns the age cutoff date', () => {
    const result = validateOrderRequest(request())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.ageCutoffDate.getFullYear()).toBe(2027)
  })

  it('refuses when the organiser has not opened registration', () => {
    const r = request()
    expect(validateOrderRequest({ ...r, listing: { ...r.listing, status: 'closed' } }))
      .toEqual({ ok: false, error: 'Registration for this feis is not open.' })
  })

  it('refuses before the opening time', () => {
    const r = request()
    expect(validateOrderRequest({ ...r, listing: { ...r.listing, reg_opens_at: '2026-11-02T00:00:00Z' } }))
      .toEqual({ ok: false, error: 'Registration for this feis has not opened yet.' })
  })

  it('refuses after the deadline, and uses the late deadline when there is one', () => {
    const r = request()
    const closed = { ...r.listing, reg_closes_at: '2026-10-31T00:00:00Z' }
    expect(validateOrderRequest({ ...r, listing: closed }))
      .toEqual({ ok: false, error: 'Registration for this feis has closed.' })
    expect(validateOrderRequest({ ...r, listing: { ...closed, late_reg_closes_at: '2026-11-15T00:00:00Z' } }).ok)
      .toBe(true)
  })

  it('refuses an empty order and duplicate entries', () => {
    expect(validateOrderRequest(request({ entries: [] })))
      .toEqual({ ok: false, error: 'Choose at least one competition.' })
    expect(validateOrderRequest(request({ entries: [{ dancerId: 'd1', competitionId: 'c1' }, { dancerId: 'd1', competitionId: 'c1' }] })))
      .toEqual({ ok: false, error: 'The same competition is listed twice for one dancer.' })
  })

  it("refuses another family's dancer and an inactive dancer", () => {
    expect(validateOrderRequest(request({ dancers: [dancer({ household_id: 'h2' })] })))
      .toEqual({ ok: false, error: 'One or more dancers do not belong to your family.' })
    expect(validateOrderRequest(request({ dancers: [dancer({ is_active: false })] })))
      .toEqual({ ok: false, error: 'Aoife is no longer active on your account.' })
  })

  it('refuses a disabled or unknown competition', () => {
    expect(validateOrderRequest(request({ competitions: [competition({ enabled: false })] })))
      .toEqual({ ok: false, error: 'One or more competitions are not available.' })
    expect(validateOrderRequest(request({ entries: [{ dancerId: 'd1', competitionId: 'nope' }] })))
      .toEqual({ ok: false, error: 'One or more competitions are not available.' })
  })

  it('refuses an ineligible age or level with the reason', () => {
    const tooOld = validateOrderRequest(request({ dancers: [dancer({ date_of_birth: '2015-05-01' })] }))
    expect(tooOld.ok).toBe(false)
    if (!tooOld.ok) expect(tooOld.error).toMatch(/^Aoife Walsh can't enter Novice Reel U10: age 11/)

    const wrongLevel = validateOrderRequest(request({ dancers: [dancer({ dance_levels: [{ dance_key: 'reel', level_key: 'PW' }] })] }))
    expect(wrongLevel.ok).toBe(false)
    if (!wrongLevel.ok) expect(wrongLevel.error).toMatch(/Level mismatch/)
  })

  it('refuses an older age group than the dancer is in, as the entry page does', () => {
    const under12 = competition({
      id: 'c12', age_group_key: 'U12', age_group_label: 'Under 12', age_max_jan1: 11,
      display_name: 'Novice Reel U12', display_code: '212R',
    })
    const under13 = competition({
      id: 'c13', age_group_key: 'U13', age_group_label: 'Under 13', age_max_jan1: 12,
      display_name: 'Novice Reel U13', display_code: '213R',
    })
    // Aoife is 11 on the cutoff date: both groups take her age, but only Under 12 is her own
    const listing = { dancers: [dancer({ date_of_birth: '2015-05-01' })], competitions: [under12, under13] }

    const older = validateOrderRequest(request({ ...listing, entries: [{ dancerId: 'd1', competitionId: 'c13' }] }))
    expect(older.ok).toBe(false)
    if (!older.ok) expect(older.error).toMatch(/^Aoife Walsh can't enter Novice Reel U13: .*own age group/)

    expect(validateOrderRequest(request({ ...listing, entries: [{ dancerId: 'd1', competitionId: 'c12' }] })).ok)
      .toBe(true)
  })
})

// Feis age is a dancer's age on January 1 of the feis year. The entry page counts it the same way.
describe('ageCutoffDateFor', () => {
  // `now` is in 2031, away from both the feis dates below and the real clock
  const in2031 = new Date('2031-06-15T12:00:00Z')

  it('uses the listing cutoff date when it has one', () => {
    const cutoff = ageCutoffDateFor({ age_cutoff_date: '2026-12-01', feis_date: '2027-03-14' }, NOW)
    expect(cutoff).toEqual(new Date(2026, 11, 1))
  })

  it('falls back to January 1 of the feis year', () => {
    const cutoff = ageCutoffDateFor({ age_cutoff_date: null, feis_date: '2026-11-15' }, in2031)
    expect(cutoff).toEqual(new Date(2026, 0, 1))
  })

  it('falls back to January 1 of the current year when there is no feis date either', () => {
    const cutoff = ageCutoffDateFor({ age_cutoff_date: null, feis_date: null }, in2031)
    expect(cutoff).toEqual(new Date(2031, 0, 1))
  })
})
