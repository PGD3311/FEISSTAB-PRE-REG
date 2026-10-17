import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOrderStore } from '@/app/_payments/order-store'
import { buildCheckoutConfig } from '@/lib/engine/checkout-config'
import { asParent, createTestDatabase, refused, type TestDatabase } from './helpers/db'
import { createDraftOrder, type DraftOrderFixture } from './helpers/fixtures'
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

function configFor(order: DraftOrderFixture, claimId: string) {
  return buildCheckoutConfig({
    registrationId: order.registrationId,
    feisListingId: order.listing.listing.id,
    claimId,
    account: 'acct_test_feis',
    totalCents: order.payload.total_cents,
    applicationFeeCents: order.payload.application_fee_cents,
    eventFeeCents: order.payload.event_fee_cents,
    snapshot: order.payload.purchase_snapshot,
    baseUrl: 'https://runfeis.test',
    now: new Date(),
  })
}

function claim(order: DraftOrderFixture, claimId = randomUUID()) {
  return store.claimCheckout({
    registrationId: order.registrationId,
    householdId: order.family.householdId,
    claimId,
    config: configFor(order, claimId),
  })
}

async function orderRow(id: string) {
  const { rows } = await db.pool.query('SELECT * FROM registrations WHERE id = $1', [id])
  return rows[0]
}

async function runExpiryJob() {
  const { rows } = await db.pool.query(`SELECT command FROM cron.job WHERE jobname = 'expire-registration-holds'`)
  await db.pool.query(rows[0].command)
}

describe('claim_checkout', () => {
  it('freezes the request, records when it was claimed, and moves the hold 15 minutes past the window', async () => {
    const order = await createDraftOrder(db.pool)
    const claimId = randomUUID()
    const config = configFor(order, claimId)
    const result = await store.claimCheckout({
      registrationId: order.registrationId, householdId: order.family.householdId, claimId, config,
    })
    expect(result).toMatchObject({ result: 'claimed', status: 'draft', claim_id: claimId, session_id: null })

    const row = await orderRow(order.registrationId)
    expect(row.checkout_claim_id).toBe(claimId)
    expect(row.checkout_config).toEqual(config)
    expect(Math.abs(new Date(row.checkout_claimed_at).getTime() - Date.now())).toBeLessThan(60_000)
    const window = new Date(row.checkout_expires_at).getTime()
    expect(new Date(row.hold_expires_at).getTime() - window).toBe(15 * 60_000)
  })

  it('adopts an existing claim instead of replacing it', async () => {
    const order = await createDraftOrder(db.pool)
    const first = await claim(order)
    const second = await claim(order)
    expect(second.result).toBe('already_claimed')
    if (first.result === 'claimed' && second.result === 'already_claimed') {
      expect(second.claim_id).toBe(first.claim_id)
      expect(second.config).toEqual(first.config)
      expect(second.claimed_at).toBe(first.claimed_at)
    }
  })

  it('gives two simultaneous claims the same claim', async () => {
    const order = await createDraftOrder(db.pool)
    const results = await Promise.all([claim(order), claim(order)])
    expect(results.map((r) => r.result).sort()).toEqual(['already_claimed', 'claimed'])
    const ids = results.map((r) => ('claim_id' in r ? r.claim_id : null))
    expect(ids[0]).toBe(ids[1])
  })

  it('refuses a request that does not describe the order', async () => {
    const order = await createDraftOrder(db.pool)
    const claimId = randomUUID()
    for (const config of [
      { ...configFor(order, claimId), total_cents: 1 },
      { ...configFor(order, claimId), account: 'acct_someone_else' },
    ]) {
      const message = await refused(store.claimCheckout({
        registrationId: order.registrationId, householdId: order.family.householdId, claimId, config,
      }))
      expect(message).toMatch(/does not match order/)
    }
    expect((await orderRow(order.registrationId)).checkout_claim_id).toBeNull()
  })

  it('refuses a request with no expiry, or a claim with no id, and leaves the order as it was', async () => {
    const order = await createDraftOrder(db.pool)
    const before = await orderRow(order.registrationId)
    const claimId = randomUUID()
    // Straight to the function: the store's types never allow either
    const rpc = pgRpc(db.pool)
    for (const args of [
      { p_claim_id: claimId, p_config: { ...configFor(order, claimId), expires_at: null } },
      { p_claim_id: null, p_config: configFor(order, claimId) },
    ]) {
      const message = await refused(rpc('claim_checkout', {
        p_registration_id: order.registrationId, p_household_id: order.family.householdId, ...args,
      }))
      expect(message).toMatch(/does not match order/)
    }
    expect(await orderRow(order.registrationId)).toEqual(before)
  })

  it('will not claim once the hold has passed', async () => {
    const order = await createDraftOrder(db.pool)
    await db.pool.query(`UPDATE registrations SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`, [order.registrationId])
    expect(await claim(order)).toEqual({ result: 'not_claimable', status: 'draft', hold_expired: true })
  })

  it('lets the organiser stop new checkouts right up to the claim', async () => {
    const closed = await createDraftOrder(db.pool)
    await db.pool.query(`UPDATE feis_listings SET status = 'closed' WHERE id = $1`, [closed.listing.listing.id])
    expect(await claim(closed)).toEqual({ result: 'blocked', reason: 'organiser_stopped' })
    expect((await orderRow(closed.registrationId)).checkout_claim_id).toBeNull()

    const disabled = await createDraftOrder(db.pool)
    await db.pool.query(`UPDATE feis_competitions SET enabled = false WHERE id = $1`, [disabled.entries[0].competitionId])
    expect(await claim(disabled)).toEqual({ result: 'blocked', reason: 'competition_unavailable' })
  })

  it('lets an attempt claimed before the organiser closed registration finish', async () => {
    const order = await createDraftOrder(db.pool)
    const claimed = await claim(order)
    if (claimed.result !== 'claimed') throw new Error('expected a claim')
    await db.pool.query(`UPDATE feis_listings SET status = 'closed' WHERE id = $1`, [order.listing.listing.id])
    expect(await store.attachCheckoutSession(order.registrationId, claimed.claim_id, 'cs_after_close'))
      .toEqual({ result: 'attached', status: 'pending_payment' })
  })
})

describe('attach_checkout_session', () => {
  it('needs the exact claim, accepts the same session twice and refuses another', async () => {
    const order = await createDraftOrder(db.pool)
    const claimed = await claim(order)
    if (claimed.result !== 'claimed') throw new Error('expected a claim')

    expect(await store.attachCheckoutSession(order.registrationId, randomUUID(), 'cs_other'))
      .toEqual({ result: 'claim_mismatch', status: 'draft' })
    expect(await store.attachCheckoutSession(order.registrationId, claimed.claim_id, 'cs_1'))
      .toEqual({ result: 'attached', status: 'pending_payment' })
    expect(await store.attachCheckoutSession(order.registrationId, claimed.claim_id, 'cs_1'))
      .toEqual({ result: 'already_attached', status: 'pending_payment' })
    expect(await store.attachCheckoutSession(order.registrationId, claimed.claim_id, 'cs_2'))
      .toEqual({ result: 'not_attachable', status: 'pending_payment', session_id: 'cs_1' })
  })

  it('refuses to attach without a claim id or a session id, and leaves the order as it was', async () => {
    const unclaimed = await createDraftOrder(db.pool)
    const claimedOrder = await createDraftOrder(db.pool)
    const claimed = await claim(claimedOrder)
    if (claimed.result !== 'claimed') throw new Error('expected a claim')
    const rpc = pgRpc(db.pool)
    const attempts: [DraftOrderFixture, Record<string, unknown>][] = [
      // An unclaimed draft and no claim id: nothing in the order to compare against
      [unclaimed, { p_claim_id: null, p_session_id: 'cs_no_claim' }],
      [claimedOrder, { p_claim_id: claimed.claim_id, p_session_id: null }],
    ]
    for (const [order, args] of attempts) {
      const before = await orderRow(order.registrationId)
      expect(await refused(rpc('attach_checkout_session', { p_registration_id: order.registrationId, ...args })))
        .toMatch(/needs the claim id and the session id/)
      expect(await orderRow(order.registrationId)).toEqual(before)
    }
  })
})

describe('cancel_order', () => {
  it('cancels an unclaimed draft without a claim, but needs the claim once there is one', async () => {
    const unclaimed = await createDraftOrder(db.pool)
    expect(await store.cancelOrder(unclaimed.registrationId, unclaimed.family.householdId, null))
      .toEqual({ result: 'cancelled', status: 'cancelled' })

    const order = await createDraftOrder(db.pool)
    const claimed = await claim(order)
    if (claimed.result !== 'claimed') throw new Error('expected a claim')
    expect(await store.cancelOrder(order.registrationId, order.family.householdId, null))
      .toEqual({ result: 'not_cancellable', status: 'draft', claim_id: claimed.claim_id })
    expect(await store.cancelOrder(order.registrationId, order.family.householdId, randomUUID()))
      .toMatchObject({ result: 'not_cancellable' })
    expect(await store.cancelOrder(order.registrationId, order.family.householdId, claimed.claim_id))
      .toEqual({ result: 'cancelled', status: 'cancelled' })
  })

  it("will not cancel another family's order", async () => {
    const order = await createDraftOrder(db.pool)
    const other = await createDraftOrder(db.pool)
    expect(await store.cancelOrder(order.registrationId, other.family.householdId, null)).toEqual({ result: 'not_found' })
    expect((await orderRow(order.registrationId)).status).toBe('draft')
  })
})

describe('expire_checkout', () => {
  it("only expires the order's own open checkout", async () => {
    const order = await createDraftOrder(db.pool)
    const claimed = await claim(order)
    if (claimed.result !== 'claimed') throw new Error('expected a claim')
    await store.attachCheckoutSession(order.registrationId, claimed.claim_id, 'cs_own')
    const base = { registrationId: order.registrationId, claimId: claimed.claim_id, sessionId: 'cs_own', account: 'acct_test_feis' }

    expect(await store.expireCheckout({ ...base, account: 'acct_other' })).toMatchObject({ result: 'ignored', why: 'mismatch' })
    expect(await store.expireCheckout({ ...base, sessionId: 'cs_old' })).toMatchObject({ result: 'ignored', why: 'mismatch' })
    expect(await store.expireCheckout({ ...base, claimId: null })).toMatchObject({ result: 'ignored', why: 'mismatch' })
    expect(await store.expireCheckout(base)).toEqual({ result: 'expired', status: 'expired' })
    expect(await store.expireCheckout(base)).toEqual({ result: 'ignored', why: 'not_open', status: 'expired' })
  })
})

describe('the expiry job', () => {
  it('leaves a claimed checkout alone until 15 minutes after its window', async () => {
    const order = await createDraftOrder(db.pool)
    await claim(order)
    await runExpiryJob()
    expect((await orderRow(order.registrationId)).status).toBe('draft')

    await db.pool.query(`UPDATE registrations SET hold_expires_at = now() - interval '1 second' WHERE id = $1`, [order.registrationId])
    await runExpiryJob()
    expect((await orderRow(order.registrationId)).status).toBe('expired')
  })
})

describe('who may call the checkout functions', () => {
  it('refuses parents', async () => {
    const order = await createDraftOrder(db.pool)
    for (const sql of [
      `SELECT claim_checkout('${order.registrationId}', '${order.family.householdId}', gen_random_uuid(), '{}')`,
      `SELECT attach_checkout_session('${order.registrationId}', gen_random_uuid(), 'cs_x')`,
      `SELECT cancel_order('${order.registrationId}', '${order.family.householdId}', NULL)`,
      `SELECT expire_checkout('${order.registrationId}', NULL, 'cs_x', 'acct_x')`,
    ]) {
      expect(await refused(asParent(db.pool, order.family.userId, (c) => c.query(sql)))).toMatch(/permission denied/)
    }
  })
})
