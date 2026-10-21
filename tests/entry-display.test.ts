import { describe, it, expect } from 'vitest'
import {
  addDancesOrderIds,
  dancerLevelSummary,
  groupForEntryForm,
  entryFeesPerDancer,
  enteredByDancer,
  entryDeadline,
  formatDeadline,
  isAddOnOrder,
  repricedNotice,
  type AddDancesOrder
} from '@/lib/entry-display'
import type { PaymentReview } from '@/lib/payment-review-messages'
import type {
  EligibleCompetition,
  FeeBreakdown,
  FeisCompetition,
  Level
} from '@/lib/types/feis-listing'

const LEVELS: Level[] = [
  { key: 'BG', label: 'Beginner', rank: 1 },
  { key: 'NOV', label: 'Novice', rank: 3 },
  { key: 'PW', label: 'Prizewinner', rank: 4 }
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
  const at = (dance_key: string, level_key: string) => ({ dance_key, level_key })

  it('names the level when every dance is at the same level', () => {
    expect(dancerLevelSummary([at('reel', 'NOV'), at('slip_jig', 'NOV')], LEVELS, 'none')).toBe(
      'Novice'
    )
  })

  it('names the level most dances are at, then the one exception', () => {
    expect(
      dancerLevelSummary(
        [at('reel', 'PW'), at('light_jig', 'NOV'), at('slip_jig', 'NOV'), at('hornpipe', 'NOV')],
        LEVELS,
        'none'
      )
    ).toBe('Novice, Prizewinner Reel')
  })

  it('lists several exception dances in dance order', () => {
    expect(
      dancerLevelSummary(
        [
          at('slip_jig', 'PW'),
          at('light_jig', 'NOV'),
          at('reel', 'PW'),
          at('treble_jig', 'NOV'),
          at('hornpipe', 'NOV')
        ],
        LEVELS,
        'none'
      )
    ).toBe('Novice, Prizewinner Reel and Slip Jig')
  })

  it('lists exceptions at more than one level, lowest level first', () => {
    expect(
      dancerLevelSummary(
        [
          at('reel', 'NOV'),
          at('light_jig', 'NOV'),
          at('single_jig', 'NOV'),
          at('hornpipe', 'PW'),
          at('slip_jig', 'BG')
        ],
        LEVELS,
        'none'
      )
    ).toBe('Novice, Beginner Slip Jig, Prizewinner Hornpipe')
  })

  it('gives a tie to the lower level', () => {
    expect(dancerLevelSummary([at('reel', 'NOV'), at('light_jig', 'BG')], LEVELS, 'none')).toBe(
      'Beginner, Novice Reel'
    )
  })

  it('spells out a dance key it does not know', () => {
    expect(
      dancerLevelSummary(
        [at('reel', 'NOV'), at('slip_jig', 'NOV'), at('hop_jig', 'BG')],
        LEVELS,
        'none'
      )
    ).toBe('Novice, Beginner Hop Jig')
  })

  it('puts championship status first', () => {
    expect(dancerLevelSummary([at('reel', 'NOV')], LEVELS, 'prelim')).toBe('Prelim champion')
    expect(dancerLevelSummary([], LEVELS, 'open')).toBe('Open champion')
  })

  it('handles a dancer with no levels and an unknown level key', () => {
    expect(dancerLevelSummary([], LEVELS, 'none')).toBe('No levels set')
    expect(dancerLevelSummary([at('reel', 'XX')], LEVELS, 'none')).toBe('XX')
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

describe('addDancesOrderIds', () => {
  const NOW = new Date('2027-03-01T12:00:00Z')
  const OPEN = {
    status: 'open' as const,
    reg_opens_at: '2027-02-01T00:00:00Z',
    reg_closes_at: '2027-03-10T00:00:00Z',
    late_reg_closes_at: null
  }

  function order(overrides: Partial<AddDancesOrder> & Pick<AddDancesOrder, 'id'>): AddDancesOrder {
    return {
      feis_listing_id: 'feis-1',
      status: 'paid',
      hold_expires_at: null,
      feis_listings: OPEN,
      ...overrides
    }
  }

  function review(overrides: Partial<PaymentReview> = {}): PaymentReview {
    return {
      registration_id: 'o1',
      support_ref: 'PAY-7KQ2M',
      message_code: 'A',
      created_at: '2027-02-20T12:00:00Z',
      resolved: false,
      ...overrides
    }
  }

  const offered = (orders: AddDancesOrder[], reviews: PaymentReview[] = [], failed = false) =>
    [...addDancesOrderIds(orders, reviews, failed, NOW)]

  it("offers a paid order's feis Add dances while it is open and nothing is in the way", () => {
    expect(offered([order({ id: 'o1' })])).toEqual(['o1'])
  })

  it('offers only the newest paid order of a feis (orders come newest first)', () => {
    expect(offered([order({ id: 'o3' }), order({ id: 'o2' }), order({ id: 'o1' })])).toEqual(['o3'])
    // Newer orders that never paid don't take the offer from the paid one
    expect(
      offered([
        order({ id: 'o4', status: 'cancelled' }),
        order({ id: 'o3', status: 'expired' }),
        order({ id: 'o2' })
      ])
    ).toEqual(['o2'])
  })

  it("offers each feis's newest paid order, and not a feis with nothing paid", () => {
    expect(
      offered([
        order({ id: 'b2', feis_listing_id: 'feis-2' }),
        order({ id: 'a2' }),
        order({ id: 'b1', feis_listing_id: 'feis-2' }),
        order({ id: 'a1' }),
        order({ id: 'c1', feis_listing_id: 'feis-3', status: 'draft' })
      ])
    ).toEqual(['b2', 'a2'])
  })

  it("doesn't offer a feis where the family has an unpaid order whose hold is still live", () => {
    for (const status of ['draft', 'pending_payment'] as const) {
      expect(
        offered([
          order({ id: 'u1', status, hold_expires_at: '2027-03-01T12:10:00Z' }),
          order({ id: 'o1' })
        ])
      ).toEqual([])
    }
    // An unpaid order with no hold time still counts as unpaid
    expect(offered([order({ id: 'u1', status: 'draft' }), order({ id: 'o1' })])).toEqual([])
  })

  it("lets a lapsed hold stop blocking: the expiry job just hasn't run yet", () => {
    expect(
      offered([
        order({ id: 'u1', status: 'pending_payment', hold_expires_at: '2027-03-01T11:59:00Z' }),
        order({ id: 'o1' })
      ])
    ).toEqual(['o1'])
    // The hold ending exactly now has lapsed too
    expect(
      offered([
        order({ id: 'u1', status: 'draft', hold_expires_at: '2027-03-01T12:00:00Z' }),
        order({ id: 'o1' })
      ])
    ).toEqual(['o1'])
  })

  it("doesn't offer a feis with an open message-A case on any of its orders", () => {
    // On the older paid order, not just the newest
    expect(
      offered([order({ id: 'o2' }), order({ id: 'o1' })], [review({ registration_id: 'o1' })])
    ).toEqual([])
    expect(offered([order({ id: 'o1' })], [review()])).toEqual([])
  })

  it('is not blocked by a closed case, a message-B case or a case on another feis', () => {
    expect(offered([order({ id: 'o1' })], [review({ resolved: true })])).toEqual(['o1'])
    expect(offered([order({ id: 'o1' })], [review({ message_code: 'B' })])).toEqual(['o1'])
    expect(
      offered(
        [order({ id: 'o1' }), order({ id: 'p1', feis_listing_id: 'feis-2' })],
        [review({ registration_id: 'p1' })]
      )
    ).toEqual(['o1'])
  })

  it("offers nothing when the payment cases couldn't be read", () => {
    expect(offered([order({ id: 'o1' })], [], true)).toEqual([])
    // Even if some rows came back: the read failed, so message A can't be ruled out
    expect(offered([order({ id: 'o1' })], [review({ registration_id: 'x' })], true)).toEqual([])
  })

  it("doesn't offer a feis that has closed, hasn't opened or isn't open", () => {
    const closed = { ...OPEN, reg_closes_at: '2027-02-28T00:00:00Z' }
    const notYetOpen = { ...OPEN, reg_opens_at: '2027-03-02T00:00:00Z' }
    const notOpen = { ...OPEN, status: 'closed' as const }
    for (const feis_listings of [closed, notYetOpen, notOpen]) {
      expect(offered([order({ id: 'o1', feis_listings })])).toEqual([])
    }
  })

  it('uses the late deadline when there is one, so a feis in its late window still offers it', () => {
    const late = {
      ...OPEN,
      reg_closes_at: '2027-02-28T00:00:00Z',
      late_reg_closes_at: '2027-03-05T00:00:00Z'
    }
    expect(offered([order({ id: 'o1', feis_listings: late })])).toEqual(['o1'])
  })
})
