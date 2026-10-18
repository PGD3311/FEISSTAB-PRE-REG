import { describe, it, expect } from 'vitest'
import {
  dancerLevelSummary,
  groupForEntryForm,
  entryFeesPerDancer,
  enteredByDancer,
  entryDeadline,
  formatDeadline,
  isAddOnOrder,
  repricedNotice
} from '@/lib/entry-display'
import type {
  EligibleCompetition,
  FeeBreakdown,
  FeisCompetition,
  Level
} from '@/lib/types/feis-listing'

const LEVELS: Level[] = [
  { key: 'BG', label: 'Beginner', rank: 1 },
  { key: 'NOV', label: 'Novice', rank: 3 }
]

function comp(overrides: Partial<FeisCompetition>): EligibleCompetition {
  return {
    eligible: true,
    reason: '',
    competition: {
      id: overrides.id ?? 'c',
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
      display_name: 'Comp',
      display_code: null,
      capacity_cap: null,
      enabled: true,
      ...overrides
    }
  }
}

describe('dancerLevelSummary', () => {
  it('names the level when every dance is at the same level', () => {
    expect(dancerLevelSummary([{ level_key: 'NOV' }, { level_key: 'NOV' }], LEVELS, 'none')).toBe(
      'Novice'
    )
  })

  it('says mixed levels when dances differ', () => {
    expect(dancerLevelSummary([{ level_key: 'NOV' }, { level_key: 'BG' }], LEVELS, 'none')).toBe(
      'Mixed levels'
    )
  })

  it('puts championship status first', () => {
    expect(dancerLevelSummary([{ level_key: 'NOV' }], LEVELS, 'prelim')).toBe('Prelim champion')
    expect(dancerLevelSummary([], LEVELS, 'open')).toBe('Open champion')
  })

  it('handles a dancer with no levels and an unknown level key', () => {
    expect(dancerLevelSummary([], LEVELS, 'none')).toBe('No levels set')
    expect(dancerLevelSummary([{ level_key: 'XX' }], LEVELS, 'none')).toBe('XX')
  })
})

describe('groupForEntryForm', () => {
  it('groups solos by level and age group, then the other types in a fixed order', () => {
    const groups = groupForEntryForm([
      comp({ id: 's1', competition_type: 'special' }),
      comp({ id: 'r', level_label: 'Novice', age_group_label: 'Under 12' }),
      comp({ id: 'ch', competition_type: 'championship' }),
      comp({ id: 'lj', level_label: 'Novice', age_group_label: 'Under 12' }),
      comp({ id: 'b', level_label: 'Beginner', age_group_label: 'Under 12' })
    ])
    expect(groups.map((g) => g.label)).toEqual([
      'Novice, Under 12',
      'Beginner, Under 12',
      'Championships',
      'Specials'
    ])
    expect(groups[0].items.map((i) => i.competition.id)).toEqual(['r', 'lj'])
  })

  it('falls back to a plain label for solos with no level or age group', () => {
    expect(groupForEntryForm([comp({})])[0].label).toBe('Solo dances')
  })
})

describe('entryFeesPerDancer', () => {
  it('sums base fees per dancer and leaves out late fees', () => {
    const breakdown = {
      line_items: [
        { dancer_id: 'a', base_fee_cents: 1500, late_fee_cents: 2500 },
        { dancer_id: 'a', base_fee_cents: 1500, late_fee_cents: 0 },
        { dancer_id: 'b', base_fee_cents: 1000, late_fee_cents: 2500 }
      ]
    } as unknown as FeeBreakdown
    expect(entryFeesPerDancer(breakdown)).toEqual({ a: 3000, b: 1000 })
  })
})

describe('entryDeadline', () => {
  const now = new Date('2027-02-20T12:00:00Z')

  it('uses the late deadline when there is one', () => {
    expect(
      entryDeadline(
        {
          reg_closes_at: '2027-02-19T04:59:00Z',
          late_reg_closes_at: '2027-02-27T04:59:00Z'
        },
        now
      )
    ).toEqual({ closesAt: '2027-02-27T04:59:00Z', closed: false })
  })

  it('reports closed once the last deadline has passed', () => {
    expect(
      entryDeadline({ reg_closes_at: '2027-02-19T04:59:00Z', late_reg_closes_at: null }, now)
    ).toEqual({ closesAt: '2027-02-19T04:59:00Z', closed: true })
  })

  it('is open with no deadline set', () => {
    expect(entryDeadline({ reg_closes_at: null, late_reg_closes_at: null }, now)).toEqual({
      closesAt: null,
      closed: false
    })
  })
})

describe('formatDeadline', () => {
  it('shows the deadline in the feis time zone', () => {
    expect(formatDeadline('2027-02-27T04:59:00Z', 'America/New_York')).toBe('Fri 26 Feb, 11:59 pm')
  })
})

describe('isAddOnOrder', () => {
  it('is an add-on when its price counted earlier paid orders', () => {
    expect(isAddOnOrder({ purchase_snapshot: { pricing: { prior: { orders: [] } } } })).toBe(true)
  })

  it("isn't for a first order, or an order made before purchase snapshots or add-ons", () => {
    expect(isAddOnOrder({ purchase_snapshot: { pricing: { prior: null } } })).toBe(false)
    expect(isAddOnOrder({ purchase_snapshot: { pricing: {} } })).toBe(false)
    expect(isAddOnOrder({ purchase_snapshot: null })).toBe(false)
  })
})

describe('enteredByDancer', () => {
  const order = (entries: [string, string][]) => ({
    registration_entries: entries.map(([dancer_id, feis_competition_id]) => ({ dancer_id, feis_competition_id }))
  })

  it('gathers each dancer\'s paid dances across every paid order, oldest order first', () => {
    const lookup = new Map([['c1', 'Reel'], ['c2', 'Slip Jig'], ['c3', 'Treble Jig']])
    const entered = enteredByDancer([order([['d1', 'c1'], ['d2', 'c3']]), order([['d1', 'c2']])], lookup)
    expect(entered).toEqual({ d1: ['Reel', 'Slip Jig'], d2: ['Treble Jig'] })
  })

  it('keeps a dance the organiser has since turned off, as long as the lookup knows it', () => {
    const enabledOnly = new Map([['c1', 'Reel']])
    const withDisabled = new Map([...enabledOnly, ['c9', 'Hornpipe (turned off)']])
    const paid = [order([['d1', 'c1'], ['d1', 'c9']])]
    // The enabled-only list loses the paid dance; the lookup that also covers paid entries keeps it
    expect(enteredByDancer(paid, enabledOnly)).toEqual({ d1: ['Reel'] })
    expect(enteredByDancer(paid, withDisabled)).toEqual({ d1: ['Reel', 'Hornpipe (turned off)'] })
  })

  it('has nothing for a dancer with no paid dances, and for no paid orders', () => {
    expect(enteredByDancer([], new Map([['c1', 'Reel']]))).toEqual({})
    expect(enteredByDancer([order([['d1', 'cX']])], new Map([['c1', 'Reel']]))).toEqual({})
  })
})

describe('repricedNotice', () => {
  it('names the new total and the Pay button', () => {
    expect(repricedNotice(4000)).toBe(
      'Your total has been updated to $40.00. Check the receipt, then press Pay to continue.'
    )
  })

  it('follows the button to "Confirm entries" when the new total is $0, and never blames fees', () => {
    const notice = repricedNotice(0)
    expect(notice).toBe(
      'Your total has been updated to $0.00. Check the receipt, then press Confirm entries to continue.'
    )
    expect(notice).not.toContain('Fees changed')
    expect(notice).not.toContain('press Pay')
  })
})
