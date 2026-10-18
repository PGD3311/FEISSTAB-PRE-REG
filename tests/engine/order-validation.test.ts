import { describe, expect, it } from 'vitest'
import {
  ageCutoffDateFor,
  canStartOrder,
  registrationWindowBlock,
  toDancerProfile,
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

// Migration 018: a guest is someone else's child the account holder enters. The row still belongs
// to the account holder's household, so the household check treats a guest like any dancer.
describe('guest dancers', () => {
  it("accepts a guest under the account holder's household, and refuses one under another", () => {
    const guest = dancer({ relationship: 'guest' })
    expect(validateOrderRequest(request({ dancers: [guest] })).ok).toBe(true)
    expect(validateOrderRequest(request({ dancers: [{ ...guest, household_id: 'h2' }] }))).toEqual({
      ok: false,
      error: 'One or more dancers do not belong to your family.'
    })
  })
})

// The entry page builds each dancer's eligibility profile with this too, so the two can't drift
describe('toDancerProfile', () => {
  it('reads the date of birth as a local date and maps each dance to its level', () => {
    const profile = toDancerProfile(
      dancer({
        championship_status: 'prelim',
        dance_levels: [
          { dance_key: 'reel', level_key: 'NOV' },
          { dance_key: 'treble_jig', level_key: 'PW' }
        ]
      })
    )
    expect(profile).toEqual({
      dob: new Date(2018, 4, 1),
      gender: 'female',
      championshipStatus: 'prelim',
      danceLevels: { reel: 'NOV', treble_jig: 'PW' }
    })
  })
})

// Spec §4: an add-on only adds. A dance already in one of the family's paid orders is refused
describe('validateOrderRequest with paid orders', () => {
  const paidOrders = [
    {
      id: 'o1',
      confirmation_number: 'RF-2026-AAAAA',
      event_fee_cents: 1000,
      entries: [
        {
          dancer_id: 'd1',
          competition_id: 'c1',
          base_fee_cents: 1500,
          late_fee_cents: 0,
          counts_toward_family_cap: true
        }
      ]
    }
  ]

  it('refuses a dance already entered and paid for, naming the dancer and the dance', () => {
    expect(validateOrderRequest(request({ paidOrders }))).toEqual({
      ok: false,
      error: 'Aoife is already entered in Novice Reel U10. Reload this page to see your entries.'
    })
  })

  it('accepts another dance for the same dancer', () => {
    const slipJig = competition({
      id: 'c2',
      dance_key: 'reel',
      display_name: 'Novice Reel U10 (second)',
      display_code: '210R2'
    })
    const result = validateOrderRequest(
      request({
        paidOrders,
        competitions: [competition(), slipJig],
        entries: [{ dancerId: 'd1', competitionId: 'c2' }]
      })
    )
    expect(result.ok).toBe(true)
  })
})

describe('canStartOrder', () => {
  const listing = {
    status: 'open' as const,
    reg_opens_at: '2026-10-01T00:00:00Z',
    reg_closes_at: '2026-12-01T00:00:00Z',
    late_reg_closes_at: null
  }
  const start = (overrides: Partial<Parameters<typeof canStartOrder>[0]> = {}) =>
    canStartOrder({ listing, now: NOW, hasUnpaidOrder: false, hasOpenMessageA: false, ...overrides })

  it('lets a new order start while registration is open', () => {
    expect(start()).toBe(true)
  })

  it("is false when the listing isn't open, before it opens and after the close date", () => {
    expect(start({ listing: { ...listing, status: 'closed' } })).toBe(false)
    expect(start({ listing: { ...listing, reg_opens_at: '2026-11-02T00:00:00Z' } })).toBe(false)
    expect(start({ listing: { ...listing, reg_closes_at: '2026-10-31T00:00:00Z' } })).toBe(false)
    // The late deadline is the close date when there is one
    expect(
      start({
        listing: {
          ...listing,
          reg_closes_at: '2026-10-31T00:00:00Z',
          late_reg_closes_at: '2026-11-15T00:00:00Z'
        }
      })
    ).toBe(true)
  })

  it('is false while the family holds an unpaid order', () => {
    expect(start({ hasUnpaidOrder: true })).toBe(false)
  })

  it('is false while message A is open, for a first order as much as an add-on', () => {
    expect(start({ hasOpenMessageA: true })).toBe(false)
  })
})

// The one window check behind canStartOrder and validateOrderRequest
describe('registrationWindowBlock', () => {
  const listing = {
    status: 'open' as const,
    reg_opens_at: '2026-10-01T00:00:00Z',
    reg_closes_at: '2026-12-01T00:00:00Z',
    late_reg_closes_at: null
  }

  it('is null while registration is open', () => {
    expect(registrationWindowBlock(listing, NOW)).toBeNull()
  })

  it('is not_open when the listing is not open, whatever the dates say', () => {
    expect(registrationWindowBlock({ ...listing, status: 'draft' }, NOW)).toBe('not_open')
    expect(registrationWindowBlock({ ...listing, status: 'closed' }, NOW)).toBe('not_open')
  })

  it('is not_yet_open before the opening time, and open from that exact moment', () => {
    const opens = new Date(listing.reg_opens_at)
    expect(registrationWindowBlock(listing, new Date(opens.getTime() - 1))).toBe('not_yet_open')
    expect(registrationWindowBlock(listing, opens)).toBeNull()
  })

  it('is closed after the close time, and still open at that exact moment', () => {
    const closes = new Date(listing.reg_closes_at)
    expect(registrationWindowBlock(listing, closes)).toBeNull()
    expect(registrationWindowBlock(listing, new Date(closes.getTime() + 1))).toBe('closed')
  })

  it('closes at the late deadline when there is one, not the normal one', () => {
    const late = { ...listing, late_reg_closes_at: '2026-12-15T00:00:00Z' }
    expect(registrationWindowBlock(late, new Date('2026-12-10T00:00:00Z'))).toBeNull()
    expect(registrationWindowBlock(late, new Date('2026-12-15T00:00:00.001Z'))).toBe('closed')
  })

  it('has no close time to pass when neither deadline is set', () => {
    const open = { ...listing, reg_opens_at: null, reg_closes_at: null }
    expect(registrationWindowBlock(open, new Date('2030-01-01T00:00:00Z'))).toBeNull()
  })
})
