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

/** The orders and entries a family has: on its own orders, or for its own dancers */
async function createdFor(householdId: string): Promise<{ orders: number; entries: number }> {
  const { rows } = await db.pool.query(
    `SELECT
       (SELECT count(*)::int FROM registrations WHERE household_id = $1) AS orders,
       (SELECT count(*)::int FROM registration_entries e
        JOIN registrations r ON r.id = e.registration_id
        JOIN dancers d ON d.id = e.dancer_id
        WHERE r.household_id = $1 OR d.household_id = $1) AS entries`,
    [householdId]
  )
  return rows[0]
}

/** A family and a feis, with a one-dance order create_order accepts as it stands */
async function oneDanceOrder() {
  const family = await createFamily(db.pool)
  const listing = await createListing(db.pool)
  const dancer = await createDancer(db.pool, family.householdId)
  const payload = buildPayload({
    listing,
    dancers: [dancer],
    entries: [{ dancerId: dancer.id, competitionId: listing.competitions[0].id }]
  })
  const submit = () => store.createOrder(family.householdId, listing.listing.id, payload)
  return { family, listing, dancer, payload, submit }
}

/** Runs statements in one transaction with triggers off, as the superuser the tests connect as */
async function withTriggersOff(...statements: string[]): Promise<void> {
  const client = await db.pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL session_replication_role = replica')
    for (const statement of statements) await client.query(statement)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
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

  it('refuses a second unpaid order for the same family and feis', async () => {
    const first = await createDraftOrder(db.pool)
    const again = await store.createOrder(
      first.family.householdId,
      first.listing.listing.id,
      first.payload
    )
    expect(again).toEqual({
      status: 'refused',
      reason: 'unpaid_order_exists',
      registration_id: first.registrationId
    })
  })

  it('refuses a total of 1 to 49 cents, and creates totals of 0 and 50 cents', async () => {
    /** A one-dance order whose total is exactly `cents`: no family fee, and a dance at that price */
    async function orderCosting(cents: number) {
      const family = await createFamily(db.pool)
      const created = await createListing(db.pool)
      const listing = {
        ...created,
        feeSchedule: { ...created.feeSchedule, event_fee_cents: 0, solo_fee_cents: cents }
      }
      const dancer = await createDancer(db.pool, family.householdId)
      const payload = buildPayload({
        listing,
        dancers: [dancer],
        entries: [{ dancerId: dancer.id, competitionId: listing.competitions[0].id }]
      })
      expect(payload.total_cents).toBe(cents)
      return {
        family,
        result: await store.createOrder(family.householdId, listing.listing.id, payload)
      }
    }

    for (const cents of [1, 20, 49]) {
      const { family, result } = await orderCosting(cents)
      expect(result, `${cents} cents`).toEqual({ status: 'refused', reason: 'amount_too_small' })
      expect(await createdFor(family.householdId)).toEqual({ orders: 0, entries: 0 })
    }
    for (const cents of [0, 50]) {
      const { family, result } = await orderCosting(cents)
      expect(result.status, `${cents} cents`).toBe('created')
      expect(await createdFor(family.householdId)).toEqual({ orders: 1, entries: 1 })
    }
  })

  it('expires a draft whose hold has passed instead of being blocked by it', async () => {
    const old = await createDraftOrder(db.pool)
    // Lapsed drafts that aren't this family's order for this feis: another family's at the same
    // feis, and this family's at another feis
    const neighbour = await createDraftOrder(db.pool, { listing: old.listing })
    const elsewhere = await createDraftOrder(db.pool, { family: old.family })
    const others = [neighbour.registrationId, elsewhere.registrationId]
    await asService(db.pool, (c) =>
      c.query(
        `UPDATE registrations SET hold_expires_at = now() - interval '1 minute' WHERE id = ANY($1)`,
        [[old.registrationId, ...others]]
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
      `SELECT id, status FROM registrations WHERE household_id = $1 AND feis_listing_id = $2
       ORDER BY created_at`,
      [old.family.householdId, old.listing.listing.id]
    )
    expect(rows).toEqual([
      { id: old.registrationId, status: 'expired' },
      { id: again.registration_id, status: 'draft' }
    ])

    // Only this family's orders for this feis expire here; the expiry job ends the others
    const { rows: untouched } = await db.pool.query(
      'SELECT id, status FROM registrations WHERE id = ANY($1) ORDER BY created_at',
      [others]
    )
    expect(untouched).toEqual([
      { id: neighbour.registrationId, status: 'draft' },
      { id: elsewhere.registrationId, status: 'draft' }
    ])
  })

  it('refuses while a 011 confirmed order is held, rather than pricing around it', async () => {
    const order = await createDraftOrder(db.pool)
    const statusCheck = (statuses: string) =>
      `ALTER TABLE registrations DROP CONSTRAINT registrations_status_check;
       ALTER TABLE registrations ADD CONSTRAINT registrations_status_check
         CHECK (status IN (${statuses}))`
    // The live database may still carry 011's status check and a confirmed order. Nothing in the
    // app makes a confirmed order any more, so this one is made with triggers off.
    await withTriggersOff(
      statusCheck(`'draft', 'pending_payment', 'confirmed', 'paid', 'expired', 'cancelled'`),
      `UPDATE registrations SET status = 'confirmed' WHERE id = '${order.registrationId}'`
    )
    try {
      expect(
        await store.createOrder(order.family.householdId, order.listing.listing.id, order.payload)
      ).toEqual({
        status: 'refused',
        reason: 'unpaid_order_exists',
        registration_id: order.registrationId
      })
      expect(await ordersFor(order.family.householdId)).toBe(1)
    } finally {
      // Back to 002's status check for the rest of this file
      await withTriggersOff(
        `UPDATE registrations SET status = 'cancelled' WHERE id = '${order.registrationId}'`,
        statusCheck(`'draft', 'pending_payment', 'paid', 'expired', 'cancelled'`)
      )
    }
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
    ).toMatch(/order entries do not match the purchase snapshot/)
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

  it("creates nothing when an entry names another competition than the snapshot's", async () => {
    const order = await oneDanceOrder()
    // Another enabled competition of the same feis at the same fee: the totals still add up
    expect(order.listing.competitions[1]).toMatchObject({
      enabled: true,
      fee_category: order.payload.entries[0].fee_category,
      fee_cents: null
    })
    order.payload.entries[0].feis_competition_id = order.listing.competitions[1].id
    expect(await refused(order.submit())).toMatch(/order entries do not match/)
    expect(await createdFor(order.family.householdId)).toEqual({ orders: 0, entries: 0 })
  })

  it("creates nothing when an entry's fee category differs from the snapshot's", async () => {
    const order = await oneDanceOrder()
    order.payload.entries[0].fee_category = 'prelim_champ'
    expect(await refused(order.submit())).toMatch(/order entries do not match/)
    expect(await createdFor(order.family.householdId)).toEqual({ orders: 0, entries: 0 })
  })

  it("creates nothing when entries plus fees less the family max isn't the total", async () => {
    const order = await oneDanceOrder()
    // The order's total is still the snapshot's grand total; only the identity between them breaks
    order.payload.purchase_snapshot.pricing.breakdown.family_cap_savings_cents += 100
    expect(await refused(order.submit())).toMatch(/totals do not match/)
    expect(await createdFor(order.family.householdId)).toEqual({ orders: 0, entries: 0 })
  })

  it("creates nothing when the late flag disagrees with the snapshot's late tier", async () => {
    const order = await oneDanceOrder()
    order.payload.is_late = true
    expect(await refused(order.submit())).toMatch(/late flag does not match/)

    // The same order priced in a late tier, sent as on time
    const lateListing = {
      ...order.listing,
      feeSchedule: {
        ...order.listing.feeSchedule,
        late_fee_tiers: [
          {
            starts_at: new Date(Date.now() - 86_400_000).toISOString(),
            fee_cents: 2500,
            family_max_cents: null
          }
        ]
      }
    }
    const late = buildPayload({
      listing: lateListing,
      dancers: [order.dancer],
      entries: [{ dancerId: order.dancer.id, competitionId: order.listing.competitions[0].id }]
    })
    expect(late.is_late).toBe(true)
    late.is_late = false
    expect(
      await refused(store.createOrder(order.family.householdId, order.listing.listing.id, late))
    ).toMatch(/late flag does not match/)
    expect(await createdFor(order.family.householdId)).toEqual({ orders: 0, entries: 0 })
  })

  it("creates nothing when the consent or terms version differs from the snapshot's", async () => {
    const order = await oneDanceOrder()
    order.payload.consent_version = 'consent-2026-01-01'
    expect(await refused(order.submit())).toMatch(/consent or terms version does not match/)

    order.payload.consent_version = CONSENT_VERSION
    order.payload.platform_terms_version = 'runfeis-terms-2026-01-01/privacy-2026-01-01'
    expect(await refused(order.submit())).toMatch(/consent or terms version does not match/)
    expect(await createdFor(order.family.householdId)).toEqual({ orders: 0, entries: 0 })
  })

  it("creates nothing for another feis's competition", async () => {
    const family = await createFamily(db.pool)
    const listing = await createListing(db.pool)
    const other = await createListing(db.pool)
    const dancer = await createDancer(db.pool, family.householdId)
    // Priced and frozen on the other feis, so the entries match the snapshot
    const payload = buildPayload({
      listing: other,
      dancers: [dancer],
      entries: [{ dancerId: dancer.id, competitionId: other.competitions[0].id }]
    })
    expect(
      await refused(store.createOrder(family.householdId, listing.listing.id, payload))
    ).toMatch(/not available/)
    expect(await createdFor(family.householdId)).toEqual({ orders: 0, entries: 0 })
  })

  it('creates nothing for a competition turned off after the order was priced', async () => {
    const order = await oneDanceOrder()
    await db.pool.query('UPDATE feis_competitions SET enabled = false WHERE id = $1', [
      order.listing.competitions[0].id
    ])
    expect(await refused(order.submit())).toMatch(/not available/)
    expect(await createdFor(order.family.householdId)).toEqual({ orders: 0, entries: 0 })
  })

  it('creates nothing for a dancer deactivated after the order was priced', async () => {
    const order = await oneDanceOrder()
    await db.pool.query('UPDATE dancers SET is_active = false WHERE id = $1', [order.dancer.id])
    expect(await refused(order.submit())).toMatch(
      /order entries name a dancer or competition that is not available/
    )
    expect(await createdFor(order.family.householdId)).toEqual({ orders: 0, entries: 0 })
  })

  it('refuses before registration opens', async () => {
    const order = await oneDanceOrder()
    await db.pool.query(
      `UPDATE feis_listings SET reg_opens_at = now() + interval '1 day' WHERE id = $1`,
      [order.listing.listing.id]
    )
    expect(await order.submit()).toEqual({ status: 'refused', reason: 'outside_window' })
    expect(await createdFor(order.family.householdId)).toEqual({ orders: 0, entries: 0 })
  })

  it('creates nothing for an order with no entries', async () => {
    const order = await oneDanceOrder()
    order.payload.entries = []
    expect(await refused(order.submit())).toMatch(/an order needs at least one entry/)
    expect(await createdFor(order.family.householdId)).toEqual({ orders: 0, entries: 0 })
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
