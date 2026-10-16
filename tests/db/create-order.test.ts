import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOrderStore } from '@/app/_payments/order-store'
import { CONSENT_VERSION, PLATFORM_TERMS_VERSION } from '@/lib/engine/purchase-snapshot'
import { asParent, asService, createTestDatabase, refused, type TestDatabase } from './helpers/db'
import {
  buildPayload,
  createDancer,
  createDraftOrder,
  createFamily,
  createListing
} from './helpers/fixtures'
import { pgRpc } from './helpers/pg-rpc'

let db: TestDatabase
let store: ReturnType<typeof createOrderStore>

beforeAll(async () => {
  db = await createTestDatabase()
  store = createOrderStore(pgRpc(db.pool))
})

afterAll(async () => {
  await db?.drop()
})

async function ordersFor(householdId: string): Promise<number> {
  const { rows } = await db.pool.query(
    'SELECT count(*)::int AS n FROM registrations WHERE household_id = $1',
    [householdId]
  )
  return rows[0].n
}

describe('create_order', () => {
  it('creates the order, its entries and its frozen details in one step', async () => {
    const order = await createDraftOrder(db.pool)
    const {
      rows: [row]
    } = await db.pool.query('SELECT * FROM registrations WHERE id = $1', [order.registrationId])
    expect(row).toMatchObject({
      status: 'draft',
      total_cents: 4000,
      application_fee_cents: 200,
      event_fee_cents: 1000,
      consent_ip: '203.0.113.7',
      consent_version: CONSENT_VERSION,
      platform_terms_version: PLATFORM_TERMS_VERSION
    })
    expect(row.purchase_snapshot).toEqual(order.payload.purchase_snapshot)
    // create_order stamps the consent time itself, as it creates the order: the payload has none
    expect(row.consent_accepted_at).toBe(row.created_at)
    const holdMinutes = (new Date(row.hold_expires_at).getTime() - Date.now()) / 60_000
    expect(holdMinutes).toBeGreaterThan(29)
    expect(holdMinutes).toBeLessThanOrEqual(30)
    const { rows: entries } = await db.pool.query(
      `SELECT count(*)::int AS n, sum(base_fee_cents)::int AS fees
       FROM registration_entries WHERE registration_id = $1`,
      [order.registrationId]
    )
    expect(entries[0]).toEqual({ n: 2, fees: 3000 })
  })

  it('refuses a second active order for the same family and feis', async () => {
    const first = await createDraftOrder(db.pool)
    const again = await store.createOrder(
      first.family.householdId,
      first.listing.listing.id,
      first.payload
    )
    expect(again).toEqual({
      status: 'refused',
      reason: 'active_order_exists',
      registration_id: first.registrationId
    })
  })

  it('expires a draft whose hold has passed instead of being blocked by it', async () => {
    const old = await createDraftOrder(db.pool)
    await asService(db.pool, (c) =>
      c.query(
        `UPDATE registrations SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`,
        [old.registrationId]
      )
    )

    const again = await store.createOrder(
      old.family.householdId,
      old.listing.listing.id,
      old.payload
    )
    expect(again.status).toBe('created')
    if (again.status !== 'created') return
    expect(again.registration_id).not.toBe(old.registrationId)

    const { rows } = await db.pool.query(
      'SELECT id, status FROM registrations WHERE household_id = $1 ORDER BY created_at',
      [old.family.householdId]
    )
    expect(rows).toEqual([
      { id: old.registrationId, status: 'expired' },
      { id: again.registration_id, status: 'draft' }
    ])
  })

  it('refuses once the organiser closes registration, and after the deadline', async () => {
    const family = await createFamily(db.pool)
    const dancer = await createDancer(db.pool, family.householdId)

    const closed = await createListing(db.pool, { status: 'closed' })
    const closedPayload = buildPayload({
      listing: closed,
      dancers: [dancer],
      entries: [{ dancerId: dancer.id, competitionId: closed.competitions[0].id }]
    })
    expect(await store.createOrder(family.householdId, closed.listing.id, closedPayload)).toEqual({
      status: 'refused',
      reason: 'listing_closed'
    })

    const late = await createListing(db.pool, {
      regClosesAt: new Date(Date.now() - 60_000).toISOString()
    })
    const latePayload = buildPayload({
      listing: late,
      dancers: [dancer],
      entries: [{ dancerId: dancer.id, competitionId: late.competitions[0].id }]
    })
    expect(await store.createOrder(family.householdId, late.listing.id, latePayload)).toEqual({
      status: 'refused',
      reason: 'outside_window'
    })
  })

  it('creates nothing when an entry does not match the frozen details', async () => {
    const family = await createFamily(db.pool)
    const listing = await createListing(db.pool)
    const dancer = await createDancer(db.pool, family.householdId)
    const payload = buildPayload({
      listing,
      dancers: [dancer],
      entries: [{ dancerId: dancer.id, competitionId: listing.competitions[0].id }]
    })
    payload.entries[0].base_fee_cents = 1
    expect(
      await refused(store.createOrder(family.householdId, listing.listing.id, payload))
    ).toMatch(/do not match the purchase snapshot/)
    expect(await ordersFor(family.householdId)).toBe(0)
  })

  it('creates nothing when the totals do not match', async () => {
    const family = await createFamily(db.pool)
    const listing = await createListing(db.pool)
    const dancer = await createDancer(db.pool, family.householdId)
    const payload = buildPayload({
      listing,
      dancers: [dancer],
      entries: [{ dancerId: dancer.id, competitionId: listing.competitions[0].id }]
    })
    payload.total_cents += 100
    expect(
      await refused(store.createOrder(family.householdId, listing.listing.id, payload))
    ).toMatch(/totals do not match/)
    expect(await ordersFor(family.householdId)).toBe(0)
  })

  it("creates nothing for another family's dancer", async () => {
    const family = await createFamily(db.pool)
    const other = await createFamily(db.pool)
    const listing = await createListing(db.pool)
    const theirDancer = await createDancer(db.pool, other.householdId)
    const payload = buildPayload({
      listing,
      dancers: [theirDancer],
      entries: [{ dancerId: theirDancer.id, competitionId: listing.competitions[0].id }]
    })
    expect(
      await refused(store.createOrder(family.householdId, listing.listing.id, payload))
    ).toMatch(/not available/)
    expect(await ordersFor(family.householdId)).toBe(0)
  })

  it('keeps the order unchanged when the parent edits the dancer afterwards', async () => {
    const order = await createDraftOrder(db.pool)
    const dancerId = order.dancers[0].id
    await asParent(db.pool, order.family.userId, async (c) => {
      await c.query(
        `UPDATE dancers SET date_of_birth = '2012-01-01', school_name = 'New School' WHERE id = $1`,
        [dancerId]
      )
      await c.query(`UPDATE dancer_dance_levels SET level_key = 'PW' WHERE dancer_id = $1`, [
        dancerId
      ])
    })
    const {
      rows: [row]
    } = await db.pool.query('SELECT purchase_snapshot FROM registrations WHERE id = $1', [
      order.registrationId
    ])
    expect(row.purchase_snapshot).toEqual(order.payload.purchase_snapshot)
    expect(row.purchase_snapshot.dancers[0]).toMatchObject({
      date_of_birth: '2018-05-01',
      school_name: 'Scoil Rince Test'
    })
  })

  it('lets only the service role create orders', async () => {
    const order = await createDraftOrder(db.pool)
    const message = await refused(
      asParent(db.pool, order.family.userId, (c) =>
        c.query('SELECT create_order($1, $2, $3)', [
          order.family.householdId,
          order.listing.listing.id,
          JSON.stringify(order.payload)
        ])
      )
    )
    expect(message).toMatch(/permission denied/)
  })

  it('serialises two submits for the same family and feis', async () => {
    const family = await createFamily(db.pool)
    const listing = await createListing(db.pool)
    const dancer = await createDancer(db.pool, family.householdId)
    const payload = buildPayload({
      listing,
      dancers: [dancer],
      entries: [{ dancerId: dancer.id, competitionId: listing.competitions[0].id }]
    })
    const results = await Promise.all([
      store.createOrder(family.householdId, listing.listing.id, payload),
      store.createOrder(family.householdId, listing.listing.id, payload)
    ])
    expect(results.map((r) => r.status).sort()).toEqual(['created', 'refused'])
    expect(await ordersFor(family.householdId)).toBe(1)
  })
})

describe('get_order_for_checkout', () => {
  it("returns the order with its listing's state, only to its own household", async () => {
    const order = await createDraftOrder(db.pool)
    const found = await store.getOrderForCheckout(order.registrationId, order.family.householdId)
    expect(found).toMatchObject({
      id: order.registrationId,
      status: 'draft',
      total_cents: 4000,
      checkout_claim_id: null,
      listing: { status: 'open', stripe_account_id: 'acct_test_feis' }
    })
    expect(found?.competition_ids.sort()).toEqual(order.entries.map((e) => e.competitionId).sort())
    expect(found?.enabled_competition_ids).toHaveLength(3)

    const stranger = await createFamily(db.pool)
    expect(await store.getOrderForCheckout(order.registrationId, stranger.householdId)).toBeNull()
  })
})
