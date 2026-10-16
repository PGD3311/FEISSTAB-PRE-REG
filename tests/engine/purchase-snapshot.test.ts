import { describe, expect, it } from 'vitest'
import { calculateFees } from '@/lib/engine/fee-calculator'
import {
  buildCreateOrderPayload,
  CONSENT_VERSION,
  pairLineItems,
  PRICING_VERSION,
  priceOrder,
  type PriceOrderInput
} from '@/lib/engine/purchase-snapshot'
import type { OrderDancer } from '@/lib/engine/order-validation'
import { parseLocalDate } from '@/lib/format'
import type { FeeSchedule, FeisCompetition } from '@/lib/types/feis-listing'

const schedule: FeeSchedule = {
  id: 's1', feis_listing_id: 'f1', event_fee_cents: 1000, solo_fee_cents: 1500, prelim_champ_fee_cents: 5000,
  open_champ_fee_cents: 6000, family_cap_cents: null, late_fee_tiers: [], day_of_surcharge_cents: 0,
}

function comp(id: string, code: string, dance: string): FeisCompetition {
  return {
    id, feis_listing_id: 'f1', age_group_key: 'U10', age_group_label: 'Under 10', age_max_jan1: 9, age_min_jan1: null,
    level_key: 'NOV', level_label: 'Novice', dance_key: dance, dance_label: dance, competition_type: 'solo',
    championship_key: null, fee_category: 'solo', fee_cents: null, exclude_from_family_cap: false, grades_only: false,
    display_name: `Novice ${dance} U10`, display_code: code, capacity_cap: null, enabled: true,
  }
}

const aoife: OrderDancer = {
  id: 'd1', household_id: 'h1', first_name: 'Aoife', last_name: 'Walsh', date_of_birth: '2018-05-01',
  gender: 'female', school_name: 'Scoil Rince', tcrg_name: 'Mary Murphy', championship_status: 'none', is_active: true,
  dance_levels: [{ dance_key: 'reel', level_key: 'NOV' }, { dance_key: 'slip_jig', level_key: 'NOV' }],
}

function input(overrides: Partial<PriceOrderInput> = {}): PriceOrderInput {
  return {
    now: new Date('2026-11-01T12:00:00Z'),
    ageCutoffDate: parseLocalDate('2027-01-01'),
    levels: [{ key: 'NOV', label: 'Novice', rank: 3 }],
    dancers: [aoife],
    competitions: [comp('c1', '210R', 'reel'), comp('c2', '210SJ', 'slip_jig')],
    entries: [{ dancerId: 'd1', competitionId: 'c1' }, { dancerId: 'd1', competitionId: 'c2' }],
    feeSchedule: schedule,
    ...overrides,
  }
}

describe('priceOrder', () => {
  it('prices with the fee calculator and freezes what the price was based on', () => {
    const { breakdown, snapshot } = priceOrder(input())
    expect(breakdown.grand_total_cents).toBe(4000)
    expect(breakdown).toEqual(calculateFees(schedule, [
      { dancer_id: 'd1', fee_category: 'solo', fee_cents_override: null, exclude_from_family_cap: false, is_day_of: false },
      { dancer_id: 'd1', fee_category: 'solo', fee_cents_override: null, exclude_from_family_cap: false, is_day_of: false },
    ], new Date('2026-11-01T12:00:00Z')))
    expect(snapshot.dancers).toEqual([{
      id: 'd1', first_name: 'Aoife', last_name: 'Walsh', school_name: 'Scoil Rince', tcrg_name: 'Mary Murphy',
      date_of_birth: '2018-05-01', gender: 'female', championship_status: 'none',
      dance_levels: { reel: 'NOV', slip_jig: 'NOV' }, competition_age: 8,
    }])
    expect(snapshot.competitions.map((c) => c.display_code)).toEqual(['210R', '210SJ'])
    // Everything eligibility and pricing read, so the order keeps what its age group and level meant
    expect(snapshot.competitions).toEqual([
      {
        id: 'c1', display_code: '210R', display_name: 'Novice reel U10', age_group_key: 'U10',
        age_group_label: 'Under 10', age_min_jan1: null, age_max_jan1: 9, level_key: 'NOV', level_label: 'Novice',
        dance_key: 'reel', dance_label: 'reel', competition_type: 'solo', championship_key: null, grades_only: false,
        fee_category: 'solo', fee_cents: null, exclude_from_family_cap: false,
      },
      {
        id: 'c2', display_code: '210SJ', display_name: 'Novice slip_jig U10', age_group_key: 'U10',
        age_group_label: 'Under 10', age_min_jan1: null, age_max_jan1: 9, level_key: 'NOV', level_label: 'Novice',
        dance_key: 'slip_jig', dance_label: 'slip_jig', competition_type: 'solo', championship_key: null,
        grades_only: false, fee_category: 'solo', fee_cents: null, exclude_from_family_cap: false,
      },
    ])
    expect(snapshot.entries).toEqual([
      { dancer_id: 'd1', competition_id: 'c1', fee_category: 'solo', base_fee_cents: 1500, late_fee_cents: 0, day_of_surcharge_cents: 0 },
      { dancer_id: 'd1', competition_id: 'c2', fee_category: 'solo', base_fee_cents: 1500, late_fee_cents: 0, day_of_surcharge_cents: 0 },
    ])
    expect(snapshot.pricing.priced_at).toBe('2026-11-01T12:00:00.000Z')
    expect(snapshot.rules).toMatchObject({ age_cutoff_date: '2027-01-01', pricing_version: PRICING_VERSION, consent_version: CONSENT_VERSION })
  })

  it("freezes each competition's age bounds, labels and pricing flags as they were at purchase", () => {
    const asSold = {
      age_group_label: 'Over 7', age_min_jan1: 7, age_max_jan1: null, level_label: 'Novice (grades)',
      dance_label: 'Reel', grades_only: true, exclude_from_family_cap: true, fee_cents: 2000,
    }
    const special = { ...comp('c1', '210R', 'reel'), ...asSold }
    const { snapshot } = priceOrder(input({ competitions: [special, comp('c2', '210SJ', 'slip_jig')] }))
    expect(snapshot.competitions[0]).toMatchObject(asSold)
  })

  it('counts a birthday on the cutoff date as the older age, the same as the cart', () => {
    const born = { ...aoife, date_of_birth: '2017-01-01' }
    const { snapshot } = priceOrder(input({ dancers: [born] }))
    expect(snapshot.dancers[0].competition_age).toBe(10)
  })

  it('keeps each entry with its own fees when a late tier applies', () => {
    const late = { ...schedule, late_fee_tiers: [{ starts_at: '2026-10-15T00:00:00Z', fee_cents: 2500, family_max_cents: null }] }
    const { snapshot, breakdown } = priceOrder(input({ feeSchedule: late }))
    expect(snapshot.entries.map((e) => e.late_fee_cents)).toEqual([2500, 0])
    expect(breakdown.grand_total_cents).toBe(6500)
  })
})

describe('buildCreateOrderPayload', () => {
  it('carries whole-cent totals, the entries and the snapshot', () => {
    const payload = buildCreateOrderPayload(priceOrder(input()), { applicationFeePercent: 3.3, consentIp: '203.0.113.7' })
    expect(payload.total_cents).toBe(4000)
    expect(payload.application_fee_cents).toBe(132)
    expect(payload.event_fee_cents).toBe(1000)
    expect(payload.is_late).toBe(false)
    expect(payload.consent_ip).toBe('203.0.113.7')
    expect(payload.entries.map((e) => e.feis_competition_id)).toEqual(['c1', 'c2'])
    expect(payload.purchase_snapshot.entries).toHaveLength(2)
  })

  /** The application fee on an order whose total is exactly `totalCents` (one entry, no event fee) */
  function applicationFee(totalCents: number, applicationFeePercent: number): number {
    const order = priceOrder(input({
      feeSchedule: { ...schedule, event_fee_cents: 0, solo_fee_cents: totalCents },
      entries: [{ dancerId: 'd1', competitionId: 'c1' }],
    }))
    expect(order.breakdown.grand_total_cents).toBe(totalCents)
    return buildCreateOrderPayload(order, { applicationFeePercent, consentIp: null }).application_fee_cents
  }

  it('works the application fee in basis points, so an exact half cent rounds up', () => {
    // As a float, 500 × 0.029 is 14.499…, which rounds to 14
    expect(applicationFee(500, 2.9)).toBe(15)
    expect(applicationFee(1000, 5)).toBe(50)
    expect(applicationFee(1000, 0)).toBe(0)
  })

  it('refuses an application fee percent that is not a number from 0 up to 100, naming it', () => {
    for (const percent of [Number.NaN, -1, 100, Infinity]) {
      expect(() => applicationFee(1000, percent), String(percent)).toThrow(new RegExp(`, not ${percent}$`))
    }
  })
})

describe('pairLineItems', () => {
  const entries = [{ dancerId: 'd1', competitionId: 'c1' }, { dancerId: 'd2', competitionId: 'c2' }]

  it('pairs each entry with its own pricing line', () => {
    const lines = [{ dancer_id: 'd1', fee: 1500 }, { dancer_id: 'd2', fee: 6000 }]
    expect(pairLineItems(entries, lines)).toEqual([
      { entry: entries[0], line: lines[0] },
      { entry: entries[1], line: lines[1] },
    ])
  })

  it('refuses a different number of lines and entries', () => {
    expect(() => pairLineItems(entries, [{ dancer_id: 'd1' }])).toThrow(/1 lines for 2 entries/)
  })

  it("refuses lines that are another dancer's, even though swapping them keeps the total", () => {
    const swapped = [{ dancer_id: 'd2' }, { dancer_id: 'd1' }]
    expect(() => pairLineItems(entries, swapped)).toThrow(/line 1 doesn't match entry 1/)
  })

  it('refuses a line for another competition when the line names one', () => {
    const lines = [{ dancer_id: 'd1', competition_id: 'c1' }, { dancer_id: 'd2', competition_id: 'c9' }]
    expect(() => pairLineItems(entries, lines)).toThrow(/line 2 doesn't match entry 2/)
  })
})
