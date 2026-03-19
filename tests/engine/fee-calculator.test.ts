import { describe, it, expect } from 'vitest'
import { calculateFees } from '@/lib/engine/fee-calculator'
import type { FeeSchedule, FeeEntry } from '@/lib/types/feis-listing'

const SCHEDULE: FeeSchedule = {
  id: 'fee-id',
  feis_listing_id: 'listing-id',
  event_fee_cents: 2500,
  solo_fee_cents: 1300,
  prelim_champ_fee_cents: 5500,
  open_champ_fee_cents: 6000,
  family_cap_cents: 15000,
  late_fee_cents: 2500,
  day_of_surcharge_cents: 5000
}

describe('calculateFees', () => {
  it('single solo entry: event_fee + solo = 3800', () => {
    const entries: FeeEntry[] = [
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: false }
    ]
    const result = calculateFees(SCHEDULE, entries)
    expect(result.event_fee_cents).toBe(2500)
    expect(result.line_items).toHaveLength(1)
    expect(result.line_items[0].base_fee_cents).toBe(1300)
    expect(result.line_items[0].late_fee_cents).toBe(0)
    expect(result.line_items[0].day_of_surcharge_cents).toBe(0)
    expect(result.line_items[0].line_total_cents).toBe(1300)
    expect(result.grand_total_cents).toBe(3800)
  })

  it('multiple solos one dancer: event_fee + 3x1300 = 6400', () => {
    const entries: FeeEntry[] = [
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: false },
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: false },
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: false }
    ]
    const result = calculateFees(SCHEDULE, entries)
    expect(result.line_items).toHaveLength(3)
    expect(result.subtotal_per_dancer['d1']).toBe(3900)
    expect(result.grand_total_cents).toBe(6400)
  })

  it('championship fees: prelim_champ = 5500', () => {
    const entries: FeeEntry[] = [
      { dancer_id: 'd1', fee_category: 'prelim_champ', is_late: false, is_day_of: false }
    ]
    const result = calculateFees(SCHEDULE, entries)
    expect(result.line_items[0].base_fee_cents).toBe(5500)
    expect(result.grand_total_cents).toBe(8000) // 2500 event + 5500
  })

  it('late fee per dancer (not per entry): first entry gets late, second gets 0', () => {
    const entries: FeeEntry[] = [
      { dancer_id: 'd1', fee_category: 'solo', is_late: true, is_day_of: false },
      { dancer_id: 'd1', fee_category: 'solo', is_late: true, is_day_of: false }
    ]
    const result = calculateFees(SCHEDULE, entries)
    expect(result.line_items[0].late_fee_cents).toBe(2500)
    expect(result.line_items[1].late_fee_cents).toBe(0)
    expect(result.grand_total_cents).toBe(2500 + 1300 + 2500 + 1300) // event + solo + late + solo
  })

  it('day-of surcharge per dancer', () => {
    const entries: FeeEntry[] = [
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: true },
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: true }
    ]
    const result = calculateFees(SCHEDULE, entries)
    expect(result.line_items[0].day_of_surcharge_cents).toBe(5000)
    expect(result.line_items[1].day_of_surcharge_cents).toBe(0)
    expect(result.grand_total_cents).toBe(2500 + 1300 + 5000 + 1300) // event + solo + surcharge + solo
  })

  it('family cap: 15 entries across 3 dancers capped to 15000', () => {
    const entries: FeeEntry[] = []
    for (let d = 1; d <= 3; d++) {
      for (let e = 0; e < 5; e++) {
        entries.push({ dancer_id: `d${d}`, fee_category: 'solo', is_late: false, is_day_of: false })
      }
    }
    const result = calculateFees(SCHEDULE, entries)
    // event_fee 2500 + 15 x 1300 = 2500 + 19500 = 22000
    expect(result.subtotal_before_cap_cents).toBe(22000)
    expect(result.family_cap_applied).toBe(true)
    expect(result.grand_total_cents).toBe(15000)
  })

  it('under cap: cap not applied', () => {
    const entries: FeeEntry[] = [
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: false }
    ]
    const result = calculateFees(SCHEDULE, entries)
    expect(result.family_cap_applied).toBe(false)
    expect(result.grand_total_cents).toBe(3800)
  })

  it('no cap (null): unlimited', () => {
    const schedule: FeeSchedule = { ...SCHEDULE, family_cap_cents: null }
    const entries: FeeEntry[] = []
    for (let d = 1; d <= 3; d++) {
      for (let e = 0; e < 5; e++) {
        entries.push({ dancer_id: `d${d}`, fee_category: 'solo', is_late: false, is_day_of: false })
      }
    }
    const result = calculateFees(schedule, entries)
    expect(result.family_cap_applied).toBe(false)
    expect(result.grand_total_cents).toBe(22000)
  })

  it('empty entries: just event fee', () => {
    const result = calculateFees(SCHEDULE, [])
    expect(result.line_items).toHaveLength(0)
    expect(result.grand_total_cents).toBe(2500)
  })

  it('zero event fee: only entry fees', () => {
    const schedule: FeeSchedule = { ...SCHEDULE, event_fee_cents: 0 }
    const entries: FeeEntry[] = [
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: false }
    ]
    const result = calculateFees(schedule, entries)
    expect(result.event_fee_cents).toBe(0)
    expect(result.grand_total_cents).toBe(1300)
  })

  it('multiple dancers: subtotal_per_dancer tracks each separately', () => {
    const entries: FeeEntry[] = [
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: false },
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: false },
      { dancer_id: 'd2', fee_category: 'prelim_champ', is_late: false, is_day_of: false }
    ]
    const result = calculateFees(SCHEDULE, entries)
    expect(result.subtotal_per_dancer['d1']).toBe(2600) // 2 x 1300
    expect(result.subtotal_per_dancer['d2']).toBe(5500) // 1 x 5500
    expect(result.grand_total_cents).toBe(2500 + 2600 + 5500) // 10600
  })

  it('integer math: odd cents stay integer', () => {
    const schedule: FeeSchedule = { ...SCHEDULE, solo_fee_cents: 1333 }
    const entries: FeeEntry[] = [
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: false },
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: false },
      { dancer_id: 'd1', fee_category: 'solo', is_late: false, is_day_of: false }
    ]
    const result = calculateFees(schedule, entries)
    // 3 x 1333 = 3999 + 2500 event = 6499
    expect(result.grand_total_cents).toBe(6499)
    expect(Number.isInteger(result.grand_total_cents)).toBe(true)
  })
})
