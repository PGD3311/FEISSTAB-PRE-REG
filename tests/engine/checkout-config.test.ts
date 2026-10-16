import { describe, expect, it } from 'vitest'
import { buildCheckoutConfig, checkoutLineItems, type CheckoutConfigInput } from '@/lib/engine/checkout-config'
import type { OrderDancer } from '@/lib/engine/order-validation'
import { buildCreateOrderPayload, priceOrder, type PurchaseSnapshot } from '@/lib/engine/purchase-snapshot'
import { parseLocalDate } from '@/lib/format'
import type { FeeSchedule, FeisCompetition } from '@/lib/types/feis-listing'

/** A frozen purchase with one dancer and one solo per fee, with every field priceOrder freezes */
function snapshot(fees: number[]): PurchaseSnapshot {
  return {
    version: 1,
    dancers: [{ id: 'd1', first_name: 'Aoife', last_name: 'Walsh', school_name: null, tcrg_name: null,
      date_of_birth: '2018-05-01', gender: 'female', championship_status: 'none', dance_levels: {}, competition_age: 8 }],
    competitions: fees.map((_, i) => ({ id: `c${i}`, display_code: `21${i}R`, display_name: `Comp ${i}`,
      age_group_key: null, age_group_label: null, age_min_jan1: null, age_max_jan1: null, level_key: null,
      level_label: null, dance_key: null, dance_label: null, competition_type: 'solo', championship_key: null,
      grades_only: false, fee_category: 'solo' as const, fee_cents: null, exclude_from_family_cap: false })),
    entries: fees.map((fee, i) => ({ dancer_id: 'd1', competition_id: `c${i}`, fee_category: 'solo' as const,
      base_fee_cents: fee, late_fee_cents: 0, day_of_surcharge_cents: 0 })),
    pricing: { fee_schedule: {} as never, breakdown: {} as never, priced_at: '2026-11-01T12:00:00.000Z' },
    rules: { age_cutoff_date: '2027-01-01', levels: [], consent_version: 'x', platform_terms_version: 'y',
      feis_terms_url: null, pricing_version: 'p', eligibility_version: 'e' },
  }
}

function configInput(overrides: Partial<CheckoutConfigInput> = {}): CheckoutConfigInput {
  return {
    registrationId: 'reg-1', feisListingId: 'feis-1', claimId: 'claim-1', account: 'acct_123',
    totalCents: 4000, applicationFeeCents: 200, eventFeeCents: 1000, snapshot: snapshot([1500, 1500]),
    baseUrl: 'https://runfeis.test', now: new Date('2026-11-01T12:00:00Z'),
    ...overrides,
  }
}

describe('buildCheckoutConfig', () => {
  it('is the same for the same order and claim', () => {
    expect(buildCheckoutConfig(configInput())).toEqual(buildCheckoutConfig(configInput()))
  })

  it('freezes the whole Stripe request', () => {
    const config = buildCheckoutConfig(configInput())
    expect(config).toMatchObject({
      version: 1, account: 'acct_123', currency: 'usd', total_cents: 4000, application_fee_cents: 200,
      payment_method_types: ['card'], client_reference_id: 'reg-1',
      metadata: { registration_id: 'reg-1', claim_id: 'claim-1' },
      idempotency_key: 'checkout:reg-1:claim-1',
      expires_at: Date.parse('2026-11-01T13:00:00Z') / 1000,
      success_url: 'https://runfeis.test/feiseanna/feis-1/register/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://runfeis.test/feiseanna/feis-1/register',
    })
  })
})

describe('checkoutLineItems', () => {
  it('lists the event fee and each entry when they add up to the total', () => {
    expect(checkoutLineItems(snapshot([1500, 1500]), 1000, 4000)).toEqual([
      { name: 'Event fee (per family)', amount_cents: 1000 },
      { name: 'Aoife: 210R Comp 0', amount_cents: 1500 },
      { name: 'Aoife: 211R Comp 1', amount_cents: 1500 },
    ])
  })

  it('charges one capped line when the family max applies, since Stripe has no negative lines', () => {
    expect(checkoutLineItems(snapshot([1500, 1500, 1500]), 1000, 4500)).toEqual([
      { name: 'Feis entries (family maximum applied)', amount_cents: 4500 },
    ])
  })

  it('leaves a free competition out instead of sending a zero-amount line', () => {
    expect(checkoutLineItems(snapshot([1500, 0]), 0, 1500)).toEqual([
      { name: 'Aoife: 210R Comp 0', amount_cents: 1500 },
    ])
  })
})

describe('the checkout for an order Submit priced', () => {
  // Two solos and a late fee, priced and frozen by the engine (Task 4)
  const schedule: FeeSchedule = {
    id: 's1', feis_listing_id: 'f1', event_fee_cents: 1000, solo_fee_cents: 1500, prelim_champ_fee_cents: 5000,
    open_champ_fee_cents: 6000, family_cap_cents: null, day_of_surcharge_cents: 0,
    late_fee_tiers: [{ starts_at: '2026-10-15T00:00:00Z', fee_cents: 2500, family_max_cents: null }],
  }
  const aoife: OrderDancer = {
    id: 'd1', household_id: 'h1', first_name: 'Aoife', last_name: 'Walsh', date_of_birth: '2018-05-01',
    gender: 'female', school_name: null, tcrg_name: null, championship_status: 'none', is_active: true,
    dance_levels: [{ dance_key: 'reel', level_key: 'NOV' }, { dance_key: 'slip_jig', level_key: 'NOV' }],
  }
  const solo = (id: string, code: string, dance: string): FeisCompetition => ({
    id, feis_listing_id: 'f1', age_group_key: 'U10', age_group_label: 'Under 10', age_max_jan1: 9, age_min_jan1: null,
    level_key: 'NOV', level_label: 'Novice', dance_key: dance, dance_label: dance, competition_type: 'solo',
    championship_key: null, fee_category: 'solo', fee_cents: null, exclude_from_family_cap: false, grades_only: false,
    display_name: `Novice ${dance} U10`, display_code: code, capacity_cap: null, enabled: true,
  })

  it("adds up to the total the family was quoted, with each fee on its own entry and the order's own application fee", () => {
    const priced = priceOrder({
      now: new Date('2026-11-01T12:00:00Z'), ageCutoffDate: parseLocalDate('2027-01-01'),
      levels: [{ key: 'NOV', label: 'Novice', rank: 3 }], feisTermsUrl: null, dancers: [aoife],
      competitions: [solo('c1', '210R', 'reel'), solo('c2', '210SJ', 'slip_jig')],
      entries: [{ dancerId: 'd1', competitionId: 'c1' }, { dancerId: 'd1', competitionId: 'c2' }],
      feeSchedule: schedule,
    })
    const order = buildCreateOrderPayload(priced, { applicationFeePercent: 2.9, consentIp: null })
    const config = buildCheckoutConfig(configInput({
      totalCents: order.total_cents, applicationFeeCents: order.application_fee_cents,
      eventFeeCents: order.event_fee_cents, snapshot: order.purchase_snapshot,
    }))
    expect(config.line_items).toEqual([
      { name: 'Event fee (per family)', amount_cents: 1000 },
      { name: 'Aoife: 210R Novice reel U10', amount_cents: 4000 },
      { name: 'Aoife: 210SJ Novice slip_jig U10', amount_cents: 1500 },
    ])
    // The config carries the fee Submit worked out in whole basis points: 2.9% of $65.00 is 188.5 cents,
    // so 189 (a float percent gives 188)
    expect(config).toMatchObject({ total_cents: 6500, application_fee_cents: 189 })
  })
})
