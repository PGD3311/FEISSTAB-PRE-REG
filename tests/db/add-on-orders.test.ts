import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createOrderStore,
  type ConfirmPaymentInput,
  type OrderStore
} from '@/app/_payments/order-store'
import { countedOrdersRecord } from '@/lib/engine/purchase-snapshot'
import type { FeeSchedule, PaidOrder } from '@/lib/types/feis-listing'
import { createTestDatabase, refused, type TestDatabase } from './helpers/db'
import {
  buildPayload,
  createAddOnOrder,
  createDancer,
  createDraftOrder,
  createFamily,
  createListing,
  insertLegacyPaidOrder,
  paidOrdersOf,
  payOrder,
  readyToPay,
  type DraftOrderFixture,
  type ListingFixture
} from './helpers/fixtures'
import { pgRpc } from './helpers/pg-rpc'

let db: TestDatabase
let store: OrderStore

beforeAll(async () => {
  db = await createTestDatabase()
  store = createOrderStore(pgRpc(db.pool))
})

afterAll(async () => {
  await db?.drop()
})

/** 019's index, as pg_get_indexdef prints it */
const UNPAID_INDEX =
  'CREATE UNIQUE INDEX idx_registrations_active_unique ON pre_registration.registrations USING btree ' +
  "(feis_listing_id, household_id) WHERE (status = ANY (ARRAY['draft'::text, 'pending_payment'::text]))"

/** claim_checkout's update (all four claim columns, the hold moved out): set directly, since it never claims a $0 order */
const CLAIM_SQL = `UPDATE registrations SET checkout_claim_id = gen_random_uuid(), checkout_config = '{}',
    checkout_claimed_at = now(), checkout_expires_at = now() + interval '60 minutes',
    hold_expires_at = now() + interval '75 minutes'
  WHERE id = $1`

type Ready = Awaited<ReturnType<typeof readyToPay>>

function payment(order: DraftOrderFixture, ready: Ready): ConfirmPaymentInput {
  return {
    registrationId: order.registrationId,
    claimId: ready.claimId,
    sessionId: ready.sessionId,
    account: ready.config.account,
    amountCents: order.payload.total_cents,
    currency: 'usd',
    paymentStatus: 'paid',
    paymentIntentId: `pi_${ready.sessionId}`,
    chargeId: null,
    eventId: `evt_${randomUUID()}`,
    source: 'webhook'
  }
}

/** Takes an order to checkout, then lets its checkout expire, so a payment for it arrives late */
async function lateOrder(order: DraftOrderFixture): Promise<Ready> {
  const ready = await readyToPay(db.pool, order)
  await store.expireCheckout({
    registrationId: order.registrationId,
    claimId: ready.claimId,
    sessionId: ready.sessionId,
    account: ready.config.account
  })
  return ready
}

async function orderRow(id: string) {
  const { rows } = await db.pool.query('SELECT * FROM registrations WHERE id = $1', [id])
  return rows[0]
}

async function ordersOf(householdId: string): Promise<number> {
  const { rows } = await db.pool.query(
    'SELECT count(*)::int AS n FROM registrations WHERE household_id = $1',
    [householdId]
  )
  return rows[0].n
}

async function counts(registrationId: string) {
  const { rows } = await db.pool.query(
    `SELECT
       (SELECT count(*)::int FROM registration_snapshots WHERE registration_id = $1) AS snapshots,
       (SELECT count(*)::int FROM notifications WHERE registration_id = $1 AND kind = 'registration_confirmation') AS emails,
       (SELECT count(*)::int FROM competitor_numbers WHERE registration_id = $1) AS numbers,
       (SELECT count(*)::int FROM payment_exceptions WHERE registration_id = $1) AS cases`,
    [registrationId]
  )
  return rows[0]
}

/** The details of the one late_payment_conflict case on an order */
async function conflictWhy(registrationId: string) {
  const { rows } = await db.pool.query(
    `SELECT details FROM payment_exceptions WHERE registration_id = $1 AND reason = 'late_payment_conflict'`,
    [registrationId]
  )
  expect(rows).toHaveLength(1)
  return rows[0].details.why
}

/** A paid first order (Aoife: Novice Reel and Slip Jig, $40.00), and a second dancer, Niamh, with no entries yet */
async function familyWithPaidOrder(listing?: ListingFixture) {
  const first = await createDraftOrder(db.pool, { listing })
  await payOrder(db.pool, first)
  const niamh = await createDancer(db.pool, first.family.householdId, { firstName: 'Niamh' })
  const base = { family: first.family, listing: first.listing, dancers: [...first.dancers, niamh] }
  const [aoife] = first.dancers
  const [reel, slipJig, trebleJig] = first.listing.competitions
  return { first, base, aoife, niamh, reel, slipJig, trebleJig }
}

/** A listing whose family max is `cents`, in the database and in the fixture */
async function cappedListing(cents: number): Promise<ListingFixture> {
  return createListing(db.pool, { familyCapCents: cents })
}

/** A feis where every dance and the family fee cost nothing, so every order is $0 */
async function freeListing(): Promise<ListingFixture> {
  const created = await createListing(db.pool)
  await db.pool.query(
    'UPDATE fee_schedules SET event_fee_cents = 0, solo_fee_cents = 0 WHERE feis_listing_id = $1',
    [created.listing.id]
  )
  return {
    ...created,
    feeSchedule: { ...created.feeSchedule, event_fee_cents: 0, solo_fee_cents: 0 }
  }
}

/** A feis whose $25.00 late fee started yesterday, so an order's first dance for a dancer carries it */
async function lateListing(): Promise<ListingFixture> {
  const created = await createListing(db.pool)
  return {
    ...created,
    feeSchedule: {
      ...created.feeSchedule,
      late_fee_tiers: [
        {
          starts_at: new Date(Date.now() - 86_400_000).toISOString(),
          fee_cents: 2500,
          family_max_cents: null
        }
      ]
    }
  }
}

/** Marks a competition as outside the family max, in the database and in the fixture */
async function excludeFromFamilyMax(
  listing: ListingFixture,
  competitionId: string
): Promise<ListingFixture> {
  await db.pool.query('UPDATE feis_competitions SET exclude_from_family_cap = true WHERE id = $1', [
    competitionId
  ])
  return {
    ...listing,
    competitions: listing.competitions.map((c) =>
      c.id === competitionId ? { ...c, exclude_from_family_cap: true } : c
    )
  }
}

describe('the unpaid-order index (019) and its check (020)', () => {
  it('covers only draft and pending_payment, and re-applying 012–017 leaves it so', async () => {
    const client = await db.pool.connect()
    const indexDef = async () =>
      (
        await client.query(
          `SELECT pg_get_indexdef('pre_registration.idx_registrations_active_unique'::regclass) AS def`
        )
      ).rows[0].def
    try {
      expect(await indexDef()).toBe(UNPAID_INDEX)
      await client.query('BEGIN')
      for (const file of [
        '012_order_integrity',
        '013_create_order',
        '014_checkout_claims',
        '015_payment_confirmation',
        '016_notification_delivery',
        '017_payments_admin'
      ]) {
        await client.query(readFileSync(`supabase/migrations/${file}.sql`, 'utf8'))
      }
      expect(await indexDef()).toBe(UNPAID_INDEX)
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })

  it('020 refuses to apply unless the index is exactly 019’s', async () => {
    const check = readFileSync('supabase/migrations/020_assert_unpaid_index.sql', 'utf8')
    const client = await db.pool.connect()
    try {
      // 019's index passes
      await client.query(check)
      for (const replacement of [
        // 002's predicate: paid orders would count as active again
        `CREATE UNIQUE INDEX idx_registrations_active_unique ON registrations (feis_listing_id, household_id)
           WHERE status NOT IN ('expired', 'cancelled')`,
        // No index at all
        null
      ]) {
        await client.query('BEGIN')
        try {
          await client.query('DROP INDEX idx_registrations_active_unique')
          if (replacement) await client.query(replacement)
          expect(await refused(client.query(check))).toMatch(/must be 019's one-unpaid-order index/)
        } finally {
          // Even when an expectation fails, the index is put back for the tests that follow
          await client.query('ROLLBACK')
        }
      }
    } finally {
      client.release()
    }
  })
})

describe('create_order with paid orders (add-on orders)', () => {
  it('creates an add-on that counts the paid order, and leaves the paid order as it was', async () => {
    const { first, base, aoife, trebleJig } = await familyWithPaidOrder()
    const paidBefore = await orderRow(first.registrationId)
    const addOn = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])

    // No second family fee: just the one dance
    expect(addOn.payload.total_cents).toBe(1500)
    expect(addOn.payload.event_fee_cents).toBe(0)
    const row = await orderRow(addOn.registrationId)
    expect(row).toMatchObject({ status: 'draft', total_cents: 1500, event_fee_cents: 0 })
    expect(row.purchase_snapshot.pricing.prior).toMatchObject({
      orders: [
        {
          id: first.registrationId,
          confirmation_number: paidBefore.confirmation_number,
          event_fee_cents: 1000
        }
      ],
      event_fee_paid: true,
      cappable_paid_cents: 3000,
      late_fee_dancer_ids: [],
      late_fees_paid_cents: 0
    })
    expect(row.purchase_snapshot.pricing.prior.orders[0].entries).toHaveLength(2)
    expect(await orderRow(first.registrationId)).toEqual(paidBefore)
  })

  it('refuses a dance already in a paid order (already_entered), and creates nothing', async () => {
    const { base, aoife, reel } = await familyWithPaidOrder()
    const paidOrders = await paidOrdersOf(db.pool, base.family.householdId, base.listing)
    const payload = buildPayload({
      ...base,
      entries: [{ dancerId: aoife.id, competitionId: reel.id }],
      paidOrders
    })
    expect(
      await store.createOrder(base.family.householdId, base.listing.listing.id, payload)
    ).toEqual({ status: 'refused', reason: 'already_entered' })
    expect(await ordersOf(base.family.householdId)).toBe(1)
  })

  it('refuses an add-on while the family holds an unpaid order (unpaid_order_exists)', async () => {
    const { base, aoife, niamh, reel, trebleJig } = await familyWithPaidOrder()
    const held = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    const paidOrders = await paidOrdersOf(db.pool, base.family.householdId, base.listing)
    const payload = buildPayload({
      ...base,
      entries: [{ dancerId: niamh.id, competitionId: reel.id }],
      paidOrders
    })
    expect(
      await store.createOrder(base.family.householdId, base.listing.listing.id, payload)
    ).toEqual({
      status: 'refused',
      reason: 'unpaid_order_exists',
      registration_id: held.registrationId
    })
    expect(await ordersOf(base.family.householdId)).toBe(2)
  })

  it("refuses a price whose counted orders aren't the family's paid orders now (paid_orders_changed)", async () => {
    const { base, niamh, reel } = await familyWithPaidOrder()
    const entries = [{ dancerId: niamh.id, competitionId: reel.id }]
    const real = await paidOrdersOf(db.pool, base.family.householdId, base.listing)
    const madeUp: PaidOrder = { ...real[0], id: randomUUID() }
    const altered: PaidOrder[] = [
      {
        ...real[0],
        entries: real[0].entries.map((e, i) => (i === 0 ? { ...e, base_fee_cents: 1 } : e))
      }
    ]
    for (const [label, paidOrders] of [
      ['stale: priced as a first order', []],
      ['made up: an order that was never paid', [...real, madeUp]],
      ['wrong figures for the paid order', altered]
    ] as [string, PaidOrder[]][]) {
      const payload = buildPayload({ ...base, entries, paidOrders })
      expect(
        await store.createOrder(base.family.householdId, base.listing.listing.id, payload),
        label
      ).toEqual({ status: 'refused', reason: 'paid_orders_changed' })
    }
    expect(await ordersOf(base.family.householdId)).toBe(1)
  })

  it("takes each paid entry's family-max flag from its own order's snapshot, not the competition now", async () => {
    const listing = await cappedListing(3500)
    const { base, aoife, slipJig, trebleJig } = await familyWithPaidOrder(listing)
    // After the family paid, the organiser takes Slip Jig out of the family max
    const changed = await excludeFromFamilyMax(base.listing, slipJig.id)
    const entries = [{ dancerId: aoife.id, competitionId: trebleJig.id }]

    // Priced with today's flag: the paid order's Slip Jig no longer counts, which isn't what it covered
    const wrong = await paidOrdersOf(db.pool, base.family.householdId, base.listing)
    const todaysFlags = wrong.map((o) => ({
      ...o,
      entries: o.entries.map((e) =>
        e.competition_id === slipJig.id ? { ...e, counts_toward_family_cap: false } : e
      )
    }))
    const refusedPayload = buildPayload({
      ...base,
      listing: changed,
      entries,
      paidOrders: todaysFlags
    })
    expect(
      await store.createOrder(base.family.householdId, base.listing.listing.id, refusedPayload)
    ).toEqual({ status: 'refused', reason: 'paid_orders_changed' })

    // Priced with the paid order's own flags: $30.00 of the $35.00 max is used, so $5.00 is left
    const addOn = await createAddOnOrder(db.pool, { ...base, listing: changed }, entries)
    expect(addOn.payload.purchase_snapshot.pricing.prior?.cappable_paid_cents).toBe(3000)
    expect(addOn.payload.total_cents).toBe(500)
  })

  it("counts a legacy paid order (no snapshot) from its rows, with the competition's current family-max flag", async () => {
    const created = await createListing(db.pool, { familyCapCents: 3500 })
    const listing = await excludeFromFamilyMax(created, created.competitions[1].id)
    const family = await createFamily(db.pool)
    const aoife = await createDancer(db.pool, family.householdId)
    const [reel, slipJig, trebleJig] = listing.competitions
    const legacyId = await insertLegacyPaidOrder(db.pool, family.householdId, listing.listing.id, [
      { dancerId: aoife.id, competitionId: reel.id },
      { dancerId: aoife.id, competitionId: slipJig.id }
    ])
    expect((await orderRow(legacyId)).purchase_snapshot).toBeNull()
    const base = { family, listing, dancers: [aoife] }
    const entries = [{ dancerId: aoife.id, competitionId: trebleJig.id }]

    // A payload that counts the legacy Slip Jig toward the max, though the competition is excluded now
    const counted = await paidOrdersOf(db.pool, family.householdId, listing)
    const otherFlag = counted.map((o) => ({
      ...o,
      entries: o.entries.map((e) => ({ ...e, counts_toward_family_cap: true }))
    }))
    expect(
      await store.createOrder(
        family.householdId,
        listing.listing.id,
        buildPayload({ ...base, entries, paidOrders: otherFlag })
      )
    ).toEqual({ status: 'refused', reason: 'paid_orders_changed' })

    // Counted from its rows: the family fee was paid, and only the Reel counts toward the max
    const addOn = await createAddOnOrder(db.pool, base, entries)
    expect(addOn.payload.purchase_snapshot.pricing.prior).toMatchObject({
      orders: [{ id: legacyId, event_fee_cents: 1000 }],
      event_fee_paid: true,
      cappable_paid_cents: 1500
    })
    expect(addOn.payload.total_cents).toBe(1500)
  })

  it('refuses a payload that breaks the once-per-family rules, whose totals still add up', async () => {
    // The family fee charged a second time
    const fee = await familyWithPaidOrder()
    const feeAddOn = buildPayload({
      ...fee.base,
      entries: [{ dancerId: fee.aoife.id, competitionId: fee.trebleJig.id }],
      paidOrders: await paidOrdersOf(db.pool, fee.base.family.householdId, fee.base.listing)
    })
    feeAddOn.event_fee_cents = 1000
    feeAddOn.total_cents += 1000
    feeAddOn.purchase_snapshot.pricing.breakdown.event_fee_cents = 1000
    feeAddOn.purchase_snapshot.pricing.breakdown.grand_total_cents += 1000
    expect(
      await refused(
        store.createOrder(fee.base.family.householdId, fee.base.listing.listing.id, feeAddOn)
      )
    ).toMatch(/order event fee does not match the counted orders/)

    // Less saved than the family max leaves: $30.00 of $35.00 used, so a $15.00 dance costs $5.00
    const max = await familyWithPaidOrder(await cappedListing(3500))
    const maxAddOn = buildPayload({
      ...max.base,
      entries: [{ dancerId: max.aoife.id, competitionId: max.trebleJig.id }],
      paidOrders: await paidOrdersOf(db.pool, max.base.family.householdId, max.base.listing)
    })
    expect(maxAddOn.total_cents).toBe(500)
    maxAddOn.total_cents = 1500
    maxAddOn.purchase_snapshot.pricing.breakdown.family_cap_savings_cents = 0
    maxAddOn.purchase_snapshot.pricing.breakdown.grand_total_cents = 1500
    expect(
      await refused(
        store.createOrder(max.base.family.householdId, max.base.listing.listing.id, maxAddOn)
      )
    ).toMatch(/order family max saving does not match the counted orders/)

    // A second late fee for a dancer the paid order already charged one
    const late = await familyWithPaidOrder(await lateListing())
    const lateAddOn = buildPayload({
      ...late.base,
      entries: [{ dancerId: late.aoife.id, competitionId: late.trebleJig.id }],
      paidOrders: await paidOrdersOf(db.pool, late.base.family.householdId, late.base.listing)
    })
    expect(lateAddOn.purchase_snapshot.entries[0].late_fee_cents).toBe(0)
    lateAddOn.entries[0].late_fee_cents = 2500
    lateAddOn.purchase_snapshot.entries[0].late_fee_cents = 2500
    lateAddOn.total_cents += 2500
    lateAddOn.purchase_snapshot.pricing.breakdown.grand_total_cents += 2500
    expect(
      await refused(
        store.createOrder(late.base.family.householdId, late.base.listing.listing.id, lateAddOn)
      )
    ).toMatch(/order late fees do not match the counted orders/)

    for (const family of [fee, max, late])
      expect(await ordersOf(family.base.family.householdId)).toBe(1)
  })

  it('refuses two late fees for one dancer within one order, whose totals still add up', async () => {
    // Niamh has no entry in the paid order, so she has paid no late fee; the add-on charges her one, on her first dance
    const late = await familyWithPaidOrder(await lateListing())
    const payload = buildPayload({
      ...late.base,
      entries: [
        { dancerId: late.niamh.id, competitionId: late.reel.id },
        { dancerId: late.niamh.id, competitionId: late.slipJig.id }
      ],
      paidOrders: await paidOrdersOf(db.pool, late.base.family.householdId, late.base.listing)
    })
    expect(payload.purchase_snapshot.entries.map((e) => e.late_fee_cents)).toEqual([2500, 0])
    // A second late fee on her second dance
    payload.entries[1].late_fee_cents = 2500
    payload.purchase_snapshot.entries[1].late_fee_cents = 2500
    payload.total_cents += 2500
    payload.purchase_snapshot.pricing.breakdown.grand_total_cents += 2500
    expect(
      await refused(
        store.createOrder(late.base.family.householdId, late.base.listing.listing.id, payload)
      )
    ).toMatch(/order late fees do not match the counted orders/)
    expect(await ordersOf(late.base.family.householdId)).toBe(1)
  })

  it('refuses an add-on whose frozen fee schedule has no family fee, though a paid order paid it', async () => {
    const { base, aoife, trebleJig } = await familyWithPaidOrder()
    const payload = buildPayload({
      ...base,
      entries: [{ dancerId: aoife.id, competitionId: trebleJig.id }],
      paidOrders: await paidOrdersOf(db.pool, base.family.householdId, base.listing)
    })
    expect(payload.event_fee_cents).toBe(0)
    delete (payload.purchase_snapshot.pricing.fee_schedule as Partial<FeeSchedule>).event_fee_cents
    expect(
      await refused(store.createOrder(base.family.householdId, base.listing.listing.id, payload))
    ).toMatch(/order is missing the frozen family fee/)
    expect(await ordersOf(base.family.householdId)).toBe(1)
  })

  it('refuses a Submit priced before a late payment was confirmed (paid_orders_changed)', async () => {
    const { base, aoife, niamh, reel, trebleJig } = await familyWithPaidOrder()
    const addOn = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    const ready = await lateOrder(addOn)

    // Submit reads the paid orders, then the late payment for the add-on is confirmed
    const paidOrders = await paidOrdersOf(db.pool, base.family.householdId, base.listing)
    const payload = buildPayload({
      ...base,
      entries: [{ dancerId: niamh.id, competitionId: reel.id }],
      paidOrders
    })
    expect((await store.confirmOrderPayment(payment(addOn, ready))).result).toBe('confirmed')

    expect(
      await store.createOrder(base.family.householdId, base.listing.listing.id, payload)
    ).toEqual({ status: 'refused', reason: 'paid_orders_changed' })
    expect(await ordersOf(base.family.householdId)).toBe(2)
  })

  it('gives two add-on Submits at once one draft, and refuses the other', async () => {
    const { base, aoife, niamh, reel, trebleJig } = await familyWithPaidOrder()
    const paidOrders = await paidOrdersOf(db.pool, base.family.householdId, base.listing)
    const results = await Promise.all([
      store.createOrder(
        base.family.householdId,
        base.listing.listing.id,
        buildPayload({
          ...base,
          entries: [{ dancerId: aoife.id, competitionId: trebleJig.id }],
          paidOrders
        })
      ),
      store.createOrder(
        base.family.householdId,
        base.listing.listing.id,
        buildPayload({
          ...base,
          entries: [{ dancerId: niamh.id, competitionId: reel.id }],
          paidOrders
        })
      )
    ])
    expect(results.map((r) => r.status).sort()).toEqual(['created', 'refused'])
    expect(results.find((r) => r.status === 'refused')).toMatchObject({
      reason: 'unpaid_order_exists'
    })
    expect(await ordersOf(base.family.householdId)).toBe(2)
  })
})

describe('confirm_free_order', () => {
  it('confirms a $0 add-on without Stripe: paid, numbered where needed, one snapshot and one email', async () => {
    // The first order uses the whole $30.00 family max, so more dances cost nothing
    const { first, base, aoife, niamh, reel, trebleJig } = await familyWithPaidOrder(
      await cappedListing(3000)
    )
    const addOn = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id },
      { dancerId: niamh.id, competitionId: reel.id }
    ])
    expect(addOn.payload.total_cents).toBe(0)

    const result = await store.confirmFreeOrder(addOn.registrationId, base.family.householdId)
    if (result.result !== 'confirmed')
      throw new Error(`expected a confirmation, got ${result.result}`)
    expect(result.confirmation_number).toMatch(/^RF-\d{4}-[A-HJKMNP-Z2-9]{5}$/)
    expect(await orderRow(addOn.registrationId)).toMatchObject({
      status: 'paid',
      total_cents: 0,
      confirmation_number: result.confirmation_number,
      hold_expires_at: null,
      checkout_claim_id: null,
      stripe_checkout_session_id: null,
      stripe_payment_intent_id: null,
      stripe_charge_id: null
    })
    // Only Niamh needed a number: Aoife keeps the one from the first order
    expect(await counts(addOn.registrationId)).toEqual({
      snapshots: 1,
      emails: 1,
      numbers: 1,
      cases: 0
    })
    const { rows: numbers } = await db.pool.query(
      'SELECT dancer_id, registration_id FROM competitor_numbers WHERE feis_listing_id = $1 AND dancer_id = ANY($2) ORDER BY competitor_number',
      [base.listing.listing.id, [aoife.id, niamh.id]]
    )
    expect(numbers).toEqual([
      { dancer_id: aoife.id, registration_id: first.registrationId },
      { dancer_id: niamh.id, registration_id: addOn.registrationId }
    ])
    const {
      rows: [snapshot]
    } = await db.pool.query(
      'SELECT snapshot_data FROM registration_snapshots WHERE registration_id = $1',
      [addOn.registrationId]
    )
    expect(snapshot.snapshot_data.payment).toMatchObject({
      confirmation_number: result.confirmation_number,
      amount_cents: 0,
      currency: 'usd',
      checkout_session_id: null,
      payment_intent_id: null,
      charge_id: null,
      account: null
    })
  })

  it('confirms a $0 order at a feis with no Stripe account', async () => {
    const listing = await freeListing()
    await db.pool.query('UPDATE feis_listings SET stripe_account_id = NULL WHERE id = $1', [
      listing.listing.id
    ])
    const order = await createDraftOrder(db.pool, { listing })
    expect(
      await store.confirmFreeOrder(order.registrationId, order.family.householdId)
    ).toMatchObject({ result: 'confirmed' })
    expect((await orderRow(order.registrationId)).status).toBe('paid')
  })

  it('confirms once when Pay is clicked twice; the second click hears it is already confirmed', async () => {
    const order = await createDraftOrder(db.pool, { listing: await freeListing() })
    const results = await Promise.all([
      store.confirmFreeOrder(order.registrationId, order.family.householdId),
      store.confirmFreeOrder(order.registrationId, order.family.householdId)
    ])
    expect(results.map((r) => r.result).sort()).toEqual(['already_confirmed', 'confirmed'])
    expect(await counts(order.registrationId)).toEqual({
      snapshots: 1,
      emails: 1,
      numbers: 1,
      cases: 0
    })
  })

  it('confirms two families at one feis at the same time, with distinct numbers and no deadlock', async () => {
    for (let round = 0; round < 3; round++) {
      const listing = await freeListing()
      const [a, b] = [
        await createDraftOrder(db.pool, { listing }),
        await createDraftOrder(db.pool, { listing })
      ]
      const results = await Promise.all([
        store.confirmFreeOrder(a.registrationId, a.family.householdId),
        store.confirmFreeOrder(b.registrationId, b.family.householdId)
      ])
      expect(results.map((r) => r.result)).toEqual(['confirmed', 'confirmed'])
      const { rows } = await db.pool.query(
        'SELECT DISTINCT competitor_number FROM competitor_numbers WHERE feis_listing_id = $1',
        [listing.listing.id]
      )
      expect(rows).toHaveLength(2)
    }
  })

  it('changes nothing after the organiser stops registration or turns off a competition, or once the hold has passed', async () => {
    const stopped = await createDraftOrder(db.pool, { listing: await freeListing() })
    await db.pool.query(`UPDATE feis_listings SET status = 'closed' WHERE id = $1`, [
      stopped.listing.listing.id
    ])
    const disabled = await createDraftOrder(db.pool, { listing: await freeListing() })
    await db.pool.query('UPDATE feis_competitions SET enabled = false WHERE id = $1', [
      disabled.entries[0].competitionId
    ])
    const lapsed = await createDraftOrder(db.pool, { listing: await freeListing() })
    await db.pool.query(
      `UPDATE registrations SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [lapsed.registrationId]
    )

    for (const [order, expected] of [
      [stopped, { result: 'blocked', reason: 'organiser_stopped' }],
      [disabled, { result: 'blocked', reason: 'competition_unavailable' }],
      [lapsed, { result: 'not_confirmable', status: 'draft', hold_expired: true }]
    ] as const) {
      const before = await orderRow(order.registrationId)
      expect(await store.confirmFreeOrder(order.registrationId, order.family.householdId)).toEqual(
        expected
      )
      expect(await orderRow(order.registrationId)).toEqual(before)
      expect(await counts(order.registrationId)).toEqual({
        snapshots: 0,
        emails: 0,
        numbers: 0,
        cases: 0
      })
    }
  })

  it("answers not_found for another family's order, and changes nothing", async () => {
    const order = await createDraftOrder(db.pool, { listing: await freeListing() })
    const stranger = await createFamily(db.pool)
    const before = await orderRow(order.registrationId)
    expect(await store.confirmFreeOrder(order.registrationId, stranger.householdId)).toEqual({
      result: 'not_found'
    })
    expect(await orderRow(order.registrationId)).toEqual(before)
  })

  it('confirms only a $0 draft: an order above 0 goes to checkout instead', async () => {
    const order = await createDraftOrder(db.pool)
    expect(await store.confirmFreeOrder(order.registrationId, order.family.householdId)).toEqual({
      result: 'not_confirmable',
      status: 'draft',
      hold_expired: false
    })
    expect((await orderRow(order.registrationId)).status).toBe('draft')
  })

  it('confirms only an unclaimed draft: an expired or cancelled $0 order, or a claimed one, is left as it is', async () => {
    const expired = await createDraftOrder(db.pool, { listing: await freeListing() })
    await db.pool.query(`UPDATE registrations SET status = 'expired' WHERE id = $1`, [
      expired.registrationId
    ])
    const cancelled = await createDraftOrder(db.pool, { listing: await freeListing() })
    await db.pool.query(`UPDATE registrations SET status = 'cancelled' WHERE id = $1`, [
      cancelled.registrationId
    ])
    // claim_checkout never claims a $0 order, so the claim is set directly
    const claimed = await createDraftOrder(db.pool, { listing: await freeListing() })
    await db.pool.query(CLAIM_SQL, [claimed.registrationId])

    for (const [order, status] of [
      [expired, 'expired'],
      [cancelled, 'cancelled'],
      [claimed, 'draft']
    ] as const) {
      const before = await orderRow(order.registrationId)
      expect(before.total_cents).toBe(0)
      expect(new Date(before.hold_expires_at).getTime()).toBeGreaterThan(Date.now())
      expect(
        await store.confirmFreeOrder(order.registrationId, order.family.householdId),
        status
      ).toEqual({ result: 'not_confirmable', status, hold_expired: false })
      expect(await orderRow(order.registrationId)).toEqual(before)
      expect(await counts(order.registrationId)).toEqual({
        snapshots: 0,
        emails: 0,
        numbers: 0,
        cases: 0
      })
    }
  })

  it('cancels a $0 draft whose counted orders no longer hold, with no case: no money moved', async () => {
    const { base, aoife, trebleJig } = await familyWithPaidOrder(await cappedListing(3000))
    const addOn = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    // A paid order the add-on didn't count, which only a hand-made order can be now
    const uncounted = await insertLegacyPaidOrder(
      db.pool,
      base.family.householdId,
      base.listing.listing.id,
      []
    )
    expect(await store.confirmFreeOrder(addOn.registrationId, base.family.householdId)).toEqual({
      result: 'paid_orders_changed',
      orders: [uncounted]
    })
    expect((await orderRow(addOn.registrationId)).status).toBe('cancelled')
    expect(await counts(addOn.registrationId)).toEqual({
      snapshots: 0,
      emails: 0,
      numbers: 0,
      cases: 0
    })
  })
})

describe("the counted orders create_order rebuilds equal the engine's", () => {
  /**
   * What Submit would freeze as pricing.prior (countedOrdersRecord over the paid orders as Submit reads them)
   * against _counted_orders over the same rows, compared as jsonb
   */
  async function expectRebuildMatchesEngine(householdId: string, listing: ListingFixture) {
    const record = countedOrdersRecord(await paidOrdersOf(db.pool, householdId, listing))
    const {
      rows: [row]
    } = await db.pool.query(
      `SELECT pre_registration._counted_orders($1, $2) AS rebuilt,
         pre_registration._counted_orders($1, $2) IS NOT DISTINCT FROM nullif($3::jsonb, 'null'::jsonb) AS same`,
      [householdId, listing.listing.id, JSON.stringify(record)]
    )
    expect(row.same).toBe(true)
    expect(row.rebuilt).toEqual(record)
    return record
  }

  /** A paid order with no confirmation number, which the database allowed before 012 */
  async function clearConfirmationNumber(id: string): Promise<void> {
    const client = await db.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SET LOCAL session_replication_role = replica')
      await client.query('UPDATE registrations SET confirmation_number = NULL WHERE id = $1', [id])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  it('is null for a family with no paid order, and a first order is created', async () => {
    const listing = await createListing(db.pool)
    const family = await createFamily(db.pool)
    expect(await expectRebuildMatchesEngine(family.householdId, listing)).toBeNull()
    await createDraftOrder(db.pool, { family, listing })
  })

  it('matches for three paid orders, three dancers, one dancer with late fees in two orders, and no confirmation number', async () => {
    // A $65.00 family max, with Treble Jig outside it
    const created = await createListing(db.pool, { familyCapCents: 6500 })
    const listing = await excludeFromFamilyMax(created, created.competitions[2].id)
    const [reel, slipJig, trebleJig] = listing.competitions
    const family = await createFamily(db.pool)
    const aoife = await createDancer(db.pool, family.householdId, { firstName: 'Aoife' })
    const niamh = await createDancer(db.pool, family.householdId, { firstName: 'Niamh' })
    const siobhan = await createDancer(db.pool, family.householdId, { firstName: 'Siobhan' })
    const feis = listing.listing.id

    await insertLegacyPaidOrder(
      db.pool,
      family.householdId,
      feis,
      [
        { dancerId: aoife.id, competitionId: reel.id, lateFeeCents: 500 },
        { dancerId: siobhan.id, competitionId: reel.id }
      ],
      { eventFeeCents: 1000 }
    )
    await insertLegacyPaidOrder(
      db.pool,
      family.householdId,
      feis,
      [
        { dancerId: aoife.id, competitionId: slipJig.id, lateFeeCents: 500 },
        { dancerId: niamh.id, competitionId: reel.id, lateFeeCents: 250 }
      ],
      { eventFeeCents: 0 }
    )
    const noNumber = await insertLegacyPaidOrder(
      db.pool,
      family.householdId,
      feis,
      [{ dancerId: niamh.id, competitionId: trebleJig.id }],
      { eventFeeCents: 0 }
    )
    await clearConfirmationNumber(noNumber)

    const record = await expectRebuildMatchesEngine(family.householdId, listing)
    expect(record).toMatchObject({
      event_fee_paid: true,
      // Treble Jig is outside the family max, so only the four Reels and Slip Jigs count
      cappable_paid_cents: 6000,
      late_fee_dancer_ids: [aoife.id, niamh.id].sort(),
      late_fees_paid_cents: 1250
    })
    expect(record?.orders).toHaveLength(3)
    expect(record?.orders.find((o) => o.id === noNumber)).toHaveProperty('confirmation_number', null)

    // create_order accepts a price that counted them: $15.00 with $5.00 of the max left costs $5.00
    const addOn = await createAddOnOrder(db.pool, { family, listing, dancers: [aoife, niamh, siobhan] }, [
      { dancerId: siobhan.id, competitionId: slipJig.id }
    ])
    expect(addOn.payload.purchase_snapshot.pricing.prior).toEqual(record)
    expect(addOn.payload.total_cents).toBe(500)
  })

  it('matches for two orders paid through confirmation, which froze their own family-max flags', async () => {
    const { base, aoife, niamh, reel, trebleJig } = await familyWithPaidOrder()
    await payOrder(
      db.pool,
      await createAddOnOrder(db.pool, base, [{ dancerId: niamh.id, competitionId: reel.id }])
    )
    const record = await expectRebuildMatchesEngine(base.family.householdId, base.listing)
    expect(record?.orders).toHaveLength(2)

    const addOn = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    expect(addOn.payload.purchase_snapshot.pricing.prior).toEqual(record)
  })

  it('matches for a paid order with no entries and no confirmation number: empty lists and zero sums', async () => {
    const listing = await createListing(db.pool)
    const family = await createFamily(db.pool)
    const dancer = await createDancer(db.pool, family.householdId)
    const emptyId = await insertLegacyPaidOrder(db.pool, family.householdId, listing.listing.id, [], {
      eventFeeCents: 0
    })
    await clearConfirmationNumber(emptyId)

    const record = await expectRebuildMatchesEngine(family.householdId, listing)
    expect(record).toEqual({
      orders: [{ id: emptyId, confirmation_number: null, event_fee_cents: 0, entries: [] }],
      event_fee_paid: false,
      cappable_paid_cents: 0,
      late_fee_dancer_ids: [],
      late_fees_paid_cents: 0
    })
    await createAddOnOrder(db.pool, { family, listing, dancers: [dancer] }, [
      { dancerId: dancer.id, competitionId: listing.competitions[0].id }
    ])
  })
})

describe('late payments with several orders', () => {
  it('confirms a late add-on payment whose only other paid order it counted', async () => {
    const { base, aoife, trebleJig } = await familyWithPaidOrder()
    const addOn = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    const ready = await lateOrder(addOn)
    expect((await store.confirmOrderPayment(payment(addOn, ready))).result).toBe('confirmed')
    expect((await orderRow(addOn.registrationId)).status).toBe('paid')
  })

  it('confirms a payment for an add-on awaiting payment whose counted orders still hold', async () => {
    const { base, aoife, trebleJig } = await familyWithPaidOrder()
    const addOn = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    await payOrder(db.pool, addOn)
    expect(await counts(addOn.registrationId)).toEqual({
      snapshots: 1,
      emails: 1,
      numbers: 0,
      cases: 0
    })
  })

  it('records a case when another order was paid since this one was priced (paid_orders_changed)', async () => {
    const { first, base, aoife, trebleJig } = await familyWithPaidOrder()
    const late = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    const ready = await lateOrder(late)
    // The family starts again and pays for the same dance, priced without the late order
    const again = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    await payOrder(db.pool, again)

    const result = await store.confirmOrderPayment(payment(late, ready))
    expect(result).toMatchObject({ result: 'exception', reason: 'late_payment_conflict' })
    expect(await conflictWhy(late.registrationId)).toEqual([
      { rule: 'paid_orders_changed', orders: [again.registrationId] }
    ])
    expect((await orderRow(late.registrationId)).status).toBe('expired')
    expect((await orderRow(again.registrationId)).status).toBe('paid')
    expect((await orderRow(first.registrationId)).status).toBe('paid')
    if (result.result !== 'exception') return
    expect(
      await refused(
        db.pool.query('SELECT payments_admin.confirm_late_payment($1, $2)', [
          result.support_ref,
          'Daniel: checking the rule'
        ])
      )
    ).toMatch(/was paid after this order was priced/)
  })

  it('records one case naming both rules when both fail', async () => {
    const { base, aoife, niamh, reel, trebleJig } = await familyWithPaidOrder()
    const late = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    const ready = await lateOrder(late)
    const paidSince = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    await payOrder(db.pool, paidSince)
    const unpaid = await createAddOnOrder(db.pool, base, [
      { dancerId: niamh.id, competitionId: reel.id }
    ])

    expect(await store.confirmOrderPayment(payment(late, ready))).toMatchObject({
      result: 'exception',
      reason: 'late_payment_conflict'
    })
    expect(await conflictWhy(late.registrationId)).toEqual([
      { rule: 'unpaid_order_exists', orders: [unpaid.registrationId] },
      { rule: 'paid_orders_changed', orders: [paidSince.registrationId] }
    ])
    expect((await counts(late.registrationId)).cases).toBe(1)
    expect((await orderRow(unpaid.registrationId)).status).toBe('draft')
  })

  it('expires another unpaid order whose hold has passed, then confirms the late payment', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await lateOrder(order)
    const newer = await store.createOrder(
      order.family.householdId,
      order.listing.listing.id,
      buildPayload({ listing: order.listing, dancers: order.dancers, entries: order.entries })
    )
    if (newer.status !== 'created') throw new Error('expected a newer order')
    // The newer draft's hold passes before the expiry job runs
    await db.pool.query(
      `UPDATE registrations SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [newer.registration_id]
    )

    expect((await store.confirmOrderPayment(payment(order, ready))).result).toBe('confirmed')
    expect((await orderRow(newer.registration_id)).status).toBe('expired')
  })

  it('confirm_late_payment cancels an unclaimed draft and confirms, keeping a counted paid order', async () => {
    const { first, base, aoife, niamh, reel, trebleJig } = await familyWithPaidOrder()
    const late = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    const ready = await lateOrder(late)
    const draft = await createAddOnOrder(db.pool, base, [
      { dancerId: niamh.id, competitionId: reel.id }
    ])
    const conflict = await store.confirmOrderPayment(payment(late, ready))
    if (conflict.result !== 'exception') throw new Error('expected a case')

    const {
      rows: [confirmed]
    } = await db.pool.query('SELECT payments_admin.confirm_late_payment($1, $2) AS result', [
      conflict.support_ref,
      'Daniel: rang the family; they want the late order'
    ])
    expect(confirmed.result).toMatchObject({
      result: 'confirmed',
      cancelled_orders: [draft.registrationId]
    })
    expect((await orderRow(late.registrationId)).status).toBe('paid')
    expect((await orderRow(draft.registrationId)).status).toBe('cancelled')
    expect((await orderRow(first.registrationId)).status).toBe('paid')
    const {
      rows: [audit]
    } = await db.pool.query('SELECT evidence FROM admin_actions WHERE support_ref = $1', [
      conflict.support_ref
    ])
    expect(audit.evidence.counted_orders).toEqual([first.registrationId])
  })

  it('confirms a $0 order racing a late payment, and the late payment is a case whichever runs first', async () => {
    for (let round = 0; round < 3; round++) {
      // The first order uses the whole family max. Treble Jig is outside the max, so adding it costs $15.00
      const { base, aoife, niamh, reel, trebleJig } = await familyWithPaidOrder(
        await cappedListing(3000)
      )
      const outside = await excludeFromFamilyMax(base.listing, trebleJig.id)
      const late = await createAddOnOrder(db.pool, { ...base, listing: outside }, [
        { dancerId: aoife.id, competitionId: trebleJig.id }
      ])
      expect(late.payload.total_cents).toBe(1500)
      const ready = await lateOrder(late)
      const free = await createAddOnOrder(db.pool, { ...base, listing: outside }, [
        { dancerId: niamh.id, competitionId: reel.id }
      ])
      expect(free.payload.total_cents).toBe(0)

      const [freeResult, lateResult] = await Promise.all([
        store.confirmFreeOrder(free.registrationId, base.family.householdId),
        store.confirmOrderPayment(payment(late, ready))
      ])
      expect(freeResult.result).toBe('confirmed')
      expect(lateResult).toMatchObject({ result: 'exception', reason: 'late_payment_conflict' })
      const why = await conflictWhy(late.registrationId)
      expect([
        JSON.stringify([{ rule: 'unpaid_order_exists', orders: [free.registrationId] }]),
        JSON.stringify([{ rule: 'paid_orders_changed', orders: [free.registrationId] }])
      ]).toContain(JSON.stringify(why))
      expect((await orderRow(late.registrationId)).status).toBe('expired')
    }
  })
})

// Daniel, 2026-10-19: RunFeis takes a flat $6 once per family per feis, from the host's share
describe("RunFeis's flat fee across a family's orders", () => {
  const feeOf = async (registrationId: string) =>
    (await orderRow(registrationId)).application_fee_cents

  it('is on the first paid order only, and never changes what the family pays', async () => {
    const { first, base, aoife, niamh, reel, trebleJig } = await familyWithPaidOrder()
    expect(first.payload.application_fee_cents).toBe(600)
    expect(first.payload.total_cents).toBe(4000)
    expect(await feeOf(first.registrationId)).toBe(600)

    // An add-on carries none; its total is the dance fee alone, as it was before the fee changed
    const addOn = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    expect(addOn.payload.total_cents).toBe(1500)
    expect(addOn.payload.application_fee_cents).toBe(0)
    expect(await feeOf(addOn.registrationId)).toBe(0)

    // And a second add-on, after the first add-on is paid too
    await payOrder(db.pool, addOn)
    const second = await createAddOnOrder(db.pool, base, [
      { dancerId: niamh.id, competitionId: reel.id }
    ])
    expect(second.payload.total_cents).toBe(1500)
    expect(second.payload.application_fee_cents).toBe(0)
    expect(await feeOf(second.registrationId)).toBe(0)
  })

  it('goes on the next paid order when the first was $0, and not again after that', async () => {
    const free = await freeListing()
    const first = await createDraftOrder(db.pool, { listing: free })
    expect(first.payload.total_cents).toBe(0)
    expect(first.payload.application_fee_cents).toBe(0)
    const confirmed = await store.confirmFreeOrder(first.registrationId, first.family.householdId)
    expect(confirmed).toMatchObject({ result: 'confirmed' })

    // The organiser sets fees, so the family's next order costs something
    await db.pool.query(
      `UPDATE fee_schedules SET event_fee_cents = 1000, solo_fee_cents = 1500
       WHERE feis_listing_id = $1`,
      [free.listing.id]
    )
    const priced: ListingFixture = {
      ...free,
      feeSchedule: { ...free.feeSchedule, event_fee_cents: 1000, solo_fee_cents: 1500 }
    }
    const niamh = await createDancer(db.pool, first.family.householdId, { firstName: 'Niamh' })
    const base = { family: first.family, listing: priced, dancers: [...first.dancers, niamh] }
    const [aoife] = first.dancers
    const [reel, , trebleJig] = priced.competitions

    const next = await createAddOnOrder(db.pool, base, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    expect(next.payload.total_cents).toBeGreaterThan(0)
    expect(next.payload.application_fee_cents).toBe(600)
    expect(await feeOf(next.registrationId)).toBe(600)

    await payOrder(db.pool, next)
    const after = await createAddOnOrder(db.pool, base, [
      { dancerId: niamh.id, competitionId: reel.id }
    ])
    expect(after.payload.total_cents).toBeGreaterThan(0)
    expect(after.payload.application_fee_cents).toBe(0)
  })

  it('is not taken again after a legacy paid order that carried the old 5% fee', async () => {
    const listing = await createListing(db.pool)
    const family = await createFamily(db.pool)
    const aoife = await createDancer(db.pool, family.householdId)
    const [reel, slipJig, trebleJig] = listing.competitions
    await insertLegacyPaidOrder(
      db.pool,
      family.householdId,
      listing.listing.id,
      [
        { dancerId: aoife.id, competitionId: reel.id },
        { dancerId: aoife.id, competitionId: slipJig.id }
      ],
      { applicationFeeCents: 200 }
    )
    const addOn = await createAddOnOrder(db.pool, { family, listing, dancers: [aoife] }, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    expect(addOn.payload.total_cents).toBe(1500)
    expect(addOn.payload.application_fee_cents).toBe(0)
  })

  it('is taken on the first paid order after a legacy order that carried no fee', async () => {
    const listing = await createListing(db.pool)
    const family = await createFamily(db.pool)
    const aoife = await createDancer(db.pool, family.householdId)
    const [reel, slipJig, trebleJig] = listing.competitions
    await insertLegacyPaidOrder(
      db.pool,
      family.householdId,
      listing.listing.id,
      [
        { dancerId: aoife.id, competitionId: reel.id },
        { dancerId: aoife.id, competitionId: slipJig.id }
      ],
      { applicationFeeCents: 0 }
    )
    const addOn = await createAddOnOrder(db.pool, { family, listing, dancers: [aoife] }, [
      { dancerId: aoife.id, competitionId: trebleJig.id }
    ])
    expect(addOn.payload.application_fee_cents).toBe(600)
  })

  it('keeps the fee out of the record create_order compares exactly', async () => {
    const { base } = await familyWithPaidOrder()
    const paid = await paidOrdersOf(db.pool, base.family.householdId, base.listing)
    expect(paid[0].application_fee_cents).toBe(600)
    expect(JSON.stringify(countedOrdersRecord(paid))).not.toContain('application_fee')
  })
})
