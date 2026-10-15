import { describe, it, expect } from 'vitest'
import { calculateFees, competitionFeeCents, getActiveLateTier } from '@/lib/engine/fee-calculator'
import type { FeeSchedule, FeeEntry, LateFeeTier } from '@/lib/types/feis-listing'

const TIER_1: LateFeeTier = {
  starts_at: '2026-10-10T00:00:00Z',
  fee_cents: 2500,
  family_max_cents: null
}
const TIER_2: LateFeeTier = {
  starts_at: '2026-10-12T00:00:00Z',
  fee_cents: 5000,
  family_max_cents: null
}

const SCHEDULE: FeeSchedule = {
  id: 'fee-id',
  feis_listing_id: 'listing-id',
  event_fee_cents: 2500,
  solo_fee_cents: 1300,
  prelim_champ_fee_cents: 5500,
  open_champ_fee_cents: 6000,
  family_cap_cents: 15000,
  late_fee_tiers: [TIER_1, TIER_2],
  day_of_surcharge_cents: 5000
}

const ON_TIME = new Date('2026-10-01T12:00:00Z')
const IN_TIER_1 = new Date('2026-10-11T12:00:00Z')
const IN_TIER_2 = new Date('2026-10-13T12:00:00Z')

function solo(dancer_id: string, extra: Partial<FeeEntry> = {}): FeeEntry {
  return { dancer_id, fee_category: 'solo', is_day_of: false, ...extra }
}

describe('calculateFees', () => {
  it('single solo entry: event_fee + solo = 3800', () => {
    const result = calculateFees(SCHEDULE, [solo('d1')], ON_TIME)
    expect(result.event_fee_cents).toBe(2500)
    expect(result.line_items).toHaveLength(1)
    expect(result.line_items[0].base_fee_cents).toBe(1300)
    expect(result.line_items[0].late_fee_cents).toBe(0)
    expect(result.line_items[0].day_of_surcharge_cents).toBe(0)
    expect(result.line_items[0].line_total_cents).toBe(1300)
    expect(result.grand_total_cents).toBe(3800)
  })

  it('multiple solos one dancer: event_fee + 3x1300 = 6400', () => {
    const result = calculateFees(SCHEDULE, [solo('d1'), solo('d1'), solo('d1')], ON_TIME)
    expect(result.line_items).toHaveLength(3)
    expect(result.subtotal_per_dancer['d1']).toBe(3900)
    expect(result.grand_total_cents).toBe(6400)
  })

  it('championship fees: prelim_champ = 5500', () => {
    const result = calculateFees(SCHEDULE, [solo('d1', { fee_category: 'prelim_champ' })], ON_TIME)
    expect(result.line_items[0].base_fee_cents).toBe(5500)
    expect(result.grand_total_cents).toBe(8000) // 2500 event + 5500
  })

  it('per-competition price overrides the category fee (e.g. Future Champ $35)', () => {
    const result = calculateFees(SCHEDULE, [solo('d1', { fee_cents_override: 3500 })], ON_TIME)
    expect(result.line_items[0].base_fee_cents).toBe(3500)
    expect(result.grand_total_cents).toBe(2500 + 3500)
  })

  it('an override of 0 is a free competition, not "no override"', () => {
    const result = calculateFees(SCHEDULE, [solo('d1', { fee_cents_override: 0 })], ON_TIME)
    expect(result.line_items[0].base_fee_cents).toBe(0)
  })

  it('day-of surcharge per dancer', () => {
    const entries = [solo('d1', { is_day_of: true }), solo('d1', { is_day_of: true })]
    const result = calculateFees(SCHEDULE, entries, ON_TIME)
    expect(result.line_items[0].day_of_surcharge_cents).toBe(5000)
    expect(result.line_items[1].day_of_surcharge_cents).toBe(0)
    expect(result.grand_total_cents).toBe(2500 + 1300 + 5000 + 1300)
  })

  it('empty entries: just event fee', () => {
    const result = calculateFees(SCHEDULE, [], ON_TIME)
    expect(result.line_items).toHaveLength(0)
    expect(result.grand_total_cents).toBe(2500)
  })

  it('zero event fee: only entry fees', () => {
    const schedule: FeeSchedule = { ...SCHEDULE, event_fee_cents: 0 }
    const result = calculateFees(schedule, [solo('d1')], ON_TIME)
    expect(result.event_fee_cents).toBe(0)
    expect(result.grand_total_cents).toBe(1300)
  })

  it('multiple dancers: subtotal_per_dancer tracks each separately', () => {
    const entries = [solo('d1'), solo('d1'), solo('d2', { fee_category: 'prelim_champ' })]
    const result = calculateFees(SCHEDULE, entries, ON_TIME)
    expect(result.subtotal_per_dancer['d1']).toBe(2600)
    expect(result.subtotal_per_dancer['d2']).toBe(5500)
    expect(result.grand_total_cents).toBe(2500 + 2600 + 5500)
  })

  it('integer math: odd cents stay integer', () => {
    const schedule: FeeSchedule = { ...SCHEDULE, solo_fee_cents: 1333 }
    const result = calculateFees(schedule, [solo('d1'), solo('d1'), solo('d1')], ON_TIME)
    expect(result.grand_total_cents).toBe(6499)
    expect(Number.isInteger(result.grand_total_cents)).toBe(true)
  })
})

describe('calculateFees: family cap (competition entry max)', () => {
  function fifteenSolos(): FeeEntry[] {
    const entries: FeeEntry[] = []
    for (let d = 1; d <= 3; d++) {
      for (let e = 0; e < 5; e++) entries.push(solo(`d${d}`))
    }
    return entries
  }

  it('caps only the entry fees; the event fee is added on top', () => {
    const result = calculateFees(SCHEDULE, fifteenSolos(), ON_TIME)
    // 15 x 1300 = 19500 entries, capped to 15000, plus 2500 event fee
    expect(result.subtotal_before_cap_cents).toBe(22000)
    expect(result.family_cap_applied).toBe(true)
    expect(result.family_cap_savings_cents).toBe(4500)
    expect(result.grand_total_cents).toBe(17500)
  })

  it('late fees are not capped', () => {
    const result = calculateFees(SCHEDULE, fifteenSolos(), IN_TIER_1)
    // 3 dancers x 2500 late on top of the capped 15000 + 2500 event fee
    expect(result.late_fees_cents).toBe(7500)
    expect(result.grand_total_cents).toBe(15000 + 2500 + 7500)
  })

  it('day-of surcharges are not capped', () => {
    const entries = fifteenSolos().map((e) => ({ ...e, is_day_of: true }))
    const result = calculateFees(SCHEDULE, entries, ON_TIME)
    expect(result.grand_total_cents).toBe(15000 + 2500 + 3 * 5000)
  })

  it('competitions marked exclude_from_family_cap are paid in full on top', () => {
    const entries = [
      ...fifteenSolos(),
      solo('d1', { fee_cents_override: 4000, exclude_from_family_cap: true })
    ]
    const result = calculateFees(SCHEDULE, entries, ON_TIME)
    expect(result.line_items[15].counts_toward_family_cap).toBe(false)
    expect(result.grand_total_cents).toBe(15000 + 2500 + 4000)
  })

  it('under the cap: nothing changes', () => {
    const result = calculateFees(SCHEDULE, [solo('d1')], ON_TIME)
    expect(result.family_cap_applied).toBe(false)
    expect(result.family_cap_savings_cents).toBe(0)
    expect(result.grand_total_cents).toBe(3800)
  })

  it('no cap (null): unlimited', () => {
    const schedule: FeeSchedule = { ...SCHEDULE, family_cap_cents: null }
    const result = calculateFees(schedule, fifteenSolos(), ON_TIME)
    expect(result.family_cap_applied).toBe(false)
    expect(result.grand_total_cents).toBe(22000)
  })

  it('matches Goodwin Jamieson 2026: $250 entry max + $30 event fee = $280 to the feis', () => {
    // Their published family max is $286; the other $6 is FeisWeb's platform fee
    const schedule: FeeSchedule = {
      ...SCHEDULE,
      event_fee_cents: 3000,
      solo_fee_cents: 1500,
      family_cap_cents: 25000
    }
    const entries: FeeEntry[] = []
    for (let i = 0; i < 20; i++) entries.push(solo(`d${i % 2}`))
    const result = calculateFees(schedule, entries, ON_TIME)
    expect(result.grand_total_cents).toBe(28000)
  })
})

describe('calculateFees: late fee tiers', () => {
  it('no late fee before the first tier starts', () => {
    const result = calculateFees(SCHEDULE, [solo('d1')], ON_TIME)
    expect(result.active_late_tier).toBeNull()
    expect(result.late_fees_cents).toBe(0)
  })

  it('tier 1 charges its fee once per dancer, not per entry', () => {
    const result = calculateFees(SCHEDULE, [solo('d1'), solo('d1')], IN_TIER_1)
    expect(result.active_late_tier).toEqual(TIER_1)
    expect(result.line_items[0].late_fee_cents).toBe(2500)
    expect(result.line_items[1].late_fee_cents).toBe(0)
    expect(result.grand_total_cents).toBe(2500 + 1300 + 2500 + 1300)
  })

  it('tier 2 replaces tier 1 once it starts', () => {
    const result = calculateFees(SCHEDULE, [solo('d1')], IN_TIER_2)
    expect(result.active_late_tier).toEqual(TIER_2)
    expect(result.late_fees_cents).toBe(5000)
  })

  it('a tier family max limits the late fee for the whole family', () => {
    const schedule: FeeSchedule = {
      ...SCHEDULE,
      late_fee_tiers: [{ ...TIER_1, family_max_cents: 2500 }]
    }
    const result = calculateFees(schedule, [solo('d1'), solo('d2'), solo('d3')], IN_TIER_1)
    expect(result.late_fees_cents).toBe(2500)
    expect(result.line_items.map((l) => l.late_fee_cents)).toEqual([2500, 0, 0])
  })

  it('a family max that is not a multiple of the fee charges the remainder', () => {
    const schedule: FeeSchedule = {
      ...SCHEDULE,
      late_fee_tiers: [{ ...TIER_1, family_max_cents: 4000 }]
    }
    const result = calculateFees(schedule, [solo('d1'), solo('d2')], IN_TIER_1)
    expect(result.line_items.map((l) => l.late_fee_cents)).toEqual([2500, 1500])
  })

  it('no tiers configured: never late', () => {
    const schedule: FeeSchedule = { ...SCHEDULE, late_fee_tiers: [] }
    const result = calculateFees(schedule, [solo('d1')], IN_TIER_2)
    expect(result.late_fees_cents).toBe(0)
  })
})

describe('getActiveLateTier', () => {
  it('picks the latest tier that has started, whatever order they are stored in', () => {
    expect(getActiveLateTier([TIER_2, TIER_1], IN_TIER_2)).toEqual(TIER_2)
    expect(getActiveLateTier([TIER_2, TIER_1], IN_TIER_1)).toEqual(TIER_1)
  })

  it('a tier starts exactly at its starts_at', () => {
    expect(getActiveLateTier([TIER_1], new Date(TIER_1.starts_at))).toEqual(TIER_1)
  })

  it('returns null before any tier', () => {
    expect(getActiveLateTier([TIER_1, TIER_2], ON_TIME)).toBeNull()
  })
})

describe('competitionFeeCents', () => {
  it('uses the competition price when it has one', () => {
    expect(competitionFeeCents({ fee_category: 'solo', fee_cents: 3500 }, SCHEDULE)).toBe(3500)
  })

  it('falls back to the category fee', () => {
    expect(competitionFeeCents({ fee_category: 'solo', fee_cents: null }, SCHEDULE)).toBe(1300)
    expect(competitionFeeCents({ fee_category: 'open_champ', fee_cents: null }, SCHEDULE)).toBe(6000)
  })
})
