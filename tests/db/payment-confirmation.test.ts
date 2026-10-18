import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOrderStore, type ConfirmPaymentInput, type OrderStore } from '@/app/_payments/order-store'
import {
  asParent,
  asRole,
  asService,
  createTestDatabase,
  refused,
  type DbRole,
  type TestDatabase
} from './helpers/db'
import {
  buildPayload,
  createDraftOrder,
  createListing,
  readyToPay,
  type DraftOrderFixture
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

type Ready = Awaited<ReturnType<typeof readyToPay>>

function payment(order: DraftOrderFixture, ready: Ready, overrides: Partial<ConfirmPaymentInput> = {}): ConfirmPaymentInput {
  return {
    registrationId: order.registrationId,
    claimId: ready.claimId,
    sessionId: ready.sessionId,
    account: ready.config.account,
    amountCents: order.payload.total_cents,
    currency: 'usd',
    paymentStatus: 'paid',
    paymentIntentId: `pi_${ready.sessionId}`,
    chargeId: 'ch_test',
    eventId: `evt_${randomUUID()}`,
    source: 'webhook',
    ...overrides,
  }
}

/** Resolves once another connection to this test database is waiting on a lock */
async function someoneIsWaiting(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { rows } = await db.pool.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)
    if (rows[0].n > 0) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('No connection started waiting on a lock')
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

async function orderRow(id: string) {
  const { rows } = await db.pool.query('SELECT * FROM registrations WHERE id = $1', [id])
  return rows[0]
}

/** Every case and every notification in this test database, row by row */
async function paymentTables() {
  const { rows } = await db.pool.query(`
    SELECT (SELECT coalesce(jsonb_agg(e ORDER BY e.id), '[]') FROM payment_exceptions e) AS cases,
      (SELECT coalesce(jsonb_agg(n ORDER BY n.id), '[]') FROM notifications n) AS notifications`)
  return rows[0]
}

/** The details of the one late payment conflict case on an order: why it is a conflict, rule by rule */
async function conflictDetails(registrationId: string) {
  const { rows } = await db.pool.query(
    `SELECT details FROM payment_exceptions
     WHERE registration_id = $1 AND reason = 'late_payment_conflict'`,
    [registrationId]
  )
  expect(rows).toHaveLength(1)
  return rows[0].details
}

describe('confirm_order_payment', () => {
  it('confirms a correct payment: paid, numbered, snapshotted and one email queued, together', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const result = await store.confirmOrderPayment(payment(order, ready))
    expect(result.result).toBe('confirmed')
    if (result.result === 'confirmed') expect(result.confirmation_number).toMatch(/^RF-\d{4}-[A-HJKMNP-Z2-9]{5}$/)

    const row = await orderRow(order.registrationId)
    expect(row).toMatchObject({ status: 'paid', stripe_payment_intent_id: `pi_${ready.sessionId}`, stripe_charge_id: 'ch_test', hold_expires_at: null })
    expect(await counts(order.registrationId)).toEqual({ snapshots: 1, emails: 1, numbers: 1, cases: 0 })

    const { rows: [snapshot] } = await db.pool.query('SELECT snapshot_data FROM registration_snapshots WHERE registration_id = $1', [order.registrationId])
    expect(snapshot.snapshot_data.purchase).toEqual(order.payload.purchase_snapshot)
    expect(snapshot.snapshot_data.payment).toMatchObject({ amount_cents: 4000, currency: 'usd', account: 'acct_test_feis' })

    const { rows: [email] } = await db.pool.query(`SELECT recipient FROM notifications WHERE registration_id = $1`, [order.registrationId])
    expect(email.recipient).toBe(order.family.email)
  })

  it('does nothing more when the same payment is confirmed again', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    await store.confirmOrderPayment(payment(order, ready))
    const again = await store.confirmOrderPayment(payment(order, ready))
    expect(again.result).toBe('already_confirmed')
    expect(await counts(order.registrationId)).toEqual({ snapshots: 1, emails: 1, numbers: 1, cases: 0 })
  })

  it('confirms nothing, and records nothing, for a payment Stripe does not call paid', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const before = await orderRow(order.registrationId)
    const tables = await paymentTables()
    expect(await store.confirmOrderPayment(payment(order, ready, { paymentStatus: 'unpaid' })))
      .toEqual({ result: 'not_paid' })
    expect(await orderRow(order.registrationId)).toEqual(before)
    expect(await paymentTables()).toEqual(tables)
  })

  it('fulfils once when two confirmations arrive together', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const results = await Promise.all([
      store.confirmOrderPayment(payment(order, ready)),
      store.confirmOrderPayment(payment(order, ready)),
    ])
    expect(results.map((r) => r.result).sort()).toEqual(['already_confirmed', 'confirmed'])
    expect(await counts(order.registrationId)).toEqual({ snapshots: 1, emails: 1, numbers: 1, cases: 0 })
  })

  it.each([
    ['amount_mismatch', { amountCents: 3999 }],
    ['currency_mismatch', { currency: 'eur' }],
    ['account_mismatch', { account: 'acct_other' }],
    ['claim_mismatch', { claimId: randomUUID() }],
    ['session_mismatch', { sessionId: 'cs_someone_else' }],
  ] as const)('records a %s case instead of confirming, once per session', async (reason, overrides) => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const first = await store.confirmOrderPayment(payment(order, ready, overrides))
    const second = await store.confirmOrderPayment(payment(order, ready, overrides))
    expect(first).toMatchObject({ result: 'exception', reason })
    expect(second).toEqual(first)
    expect((await orderRow(order.registrationId)).status).toBe('pending_payment')
    const { rows } = await db.pool.query(
      `SELECT e.severity, e.support_ref, (SELECT count(*)::int FROM notifications n WHERE n.exception_id = e.id) AS alerts
       FROM payment_exceptions e WHERE e.registration_id = $1`, [order.registrationId])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ severity: 'blocking', alerts: 1 })
    expect(rows[0].support_ref).toMatch(/^PAY-[A-HJKMNP-Z2-9]{5}$/)
  })

  it('refuses a payment already recorded on another order', async () => {
    const first = await createDraftOrder(db.pool)
    const firstReady = await readyToPay(db.pool, first)
    await store.confirmOrderPayment(payment(first, firstReady))
    const second = await createDraftOrder(db.pool)
    const secondReady = await readyToPay(db.pool, second)
    const result = await store.confirmOrderPayment(payment(second, secondReady, { paymentIntentId: `pi_${firstReady.sessionId}` }))
    expect(result).toMatchObject({ result: 'exception', reason: 'payment_reused' })
  })

  it('confirms a payment that arrived before Pay attached its session', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order, { attach: false })
    expect((await store.confirmOrderPayment(payment(order, ready))).result).toBe('confirmed')
    expect(await orderRow(order.registrationId)).toMatchObject({ status: 'paid', stripe_checkout_session_id: ready.sessionId })
  })

  it('confirms a late payment when nothing conflicts', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    await store.expireCheckout({ registrationId: order.registrationId, claimId: ready.claimId, sessionId: ready.sessionId, account: ready.config.account })
    expect((await store.confirmOrderPayment(payment(order, ready))).result).toBe('confirmed')
    expect((await orderRow(order.registrationId)).status).toBe('paid')
  })

  it('keeps both orders and records a case when a late payment conflicts with a newer order', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    await store.expireCheckout({ registrationId: order.registrationId, claimId: ready.claimId, sessionId: ready.sessionId, account: ready.config.account })
    const newer = await store.createOrder(order.family.householdId, order.listing.listing.id,
      buildPayload({ listing: order.listing, dancers: order.dancers, entries: order.entries }))
    expect(newer.status).toBe('created')

    const result = await store.confirmOrderPayment(payment(order, ready))
    expect(result).toMatchObject({ result: 'exception', reason: 'late_payment_conflict' })
    expect((await orderRow(order.registrationId)).status).toBe('expired')
    if (newer.status !== 'created') return
    expect((await orderRow(newer.registration_id)).status).toBe('draft')
    expect((await conflictDetails(order.registrationId)).why).toEqual([
      { rule: 'unpaid_order_exists', orders: [newer.registration_id] }
    ])
  })

  it('records a case, and keeps the new draft, when Submit replaced an order whose hold had passed', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    expect((await orderRow(order.registrationId)).status).toBe('pending_payment')
    // The hold passes while the expiry job has not yet run, so the order is still pending_payment
    await asService(db.pool, (c) =>
      c.query(`UPDATE registrations SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`, [order.registrationId]))
    expect((await orderRow(order.registrationId)).status).toBe('pending_payment')

    // The family submits again: create_order expires the lapsed order and makes a new draft
    const newer = await store.createOrder(order.family.householdId, order.listing.listing.id,
      buildPayload({ listing: order.listing, dancers: order.dancers, entries: order.entries }))
    expect(newer.status).toBe('created')
    if (newer.status !== 'created') return
    expect((await orderRow(order.registrationId)).status).toBe('expired')

    // The old order's payment arrives, on its own claim and session: nothing is lost
    const result = await store.confirmOrderPayment(payment(order, ready))
    if (result.result !== 'exception') throw new Error(`expected a case, got ${result.result}`)
    expect(result.reason).toBe('late_payment_conflict')
    expect((await conflictDetails(order.registrationId)).why).toEqual([
      { rule: 'unpaid_order_exists', orders: [newer.registration_id] }
    ])

    expect(await orderRow(order.registrationId)).toMatchObject({ status: 'expired', paid_at: null, confirmation_number: null })
    expect(await orderRow(newer.registration_id)).toMatchObject({ status: 'draft' })
    expect(await counts(order.registrationId)).toEqual({ snapshots: 0, emails: 0, numbers: 0, cases: 1 })
    expect(await counts(newer.registration_id)).toEqual({ snapshots: 0, emails: 0, numbers: 0, cases: 0 })

    // The case carries the payment, so someone can refund it or honour it
    const { rows } = await db.pool.query(
      `SELECT e.severity, e.reason, e.support_ref, e.claim_id, e.stripe_checkout_session_id, e.stripe_payment_intent_id,
         e.amount_cents, e.currency, e.status, (SELECT count(*)::int FROM notifications n WHERE n.exception_id = e.id) AS alerts
       FROM payment_exceptions e WHERE e.registration_id = $1`, [order.registrationId])
    expect(rows).toEqual([{
      severity: 'blocking', reason: 'late_payment_conflict', support_ref: result.support_ref,
      claim_id: ready.claimId, stripe_checkout_session_id: ready.sessionId, stripe_payment_intent_id: `pi_${ready.sessionId}`,
      amount_cents: 4000, currency: 'usd', status: 'open', alerts: 1,
    }])

    // And the family sees it, against the order that was replaced
    const mine = await asParent(db.pool, order.family.userId, async (c) =>
      (await c.query('SELECT get_my_payment_reviews(NULL) AS reviews')).rows[0].reviews)
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ registration_id: order.registrationId, message_code: 'A', resolved: false })
  })

  describe('a late payment already recorded as a conflict case', () => {
    /** The first conflict test's setup, then the family does as message A says and the newer draft ends */
    async function conflictThenNewerOrderEnds() {
      const order = await createDraftOrder(db.pool)
      const ready = await readyToPay(db.pool, order)
      await store.expireCheckout({ registrationId: order.registrationId, claimId: ready.claimId, sessionId: ready.sessionId, account: ready.config.account })
      const newer = await store.createOrder(order.family.householdId, order.listing.listing.id,
        buildPayload({ listing: order.listing, dancers: order.dancers, entries: order.entries }))
      if (newer.status !== 'created') throw new Error(`expected a newer order, got ${newer.status}`)

      const first = await store.confirmOrderPayment(payment(order, ready))
      if (first.result !== 'exception') throw new Error(`expected a case, got ${first.result}`)
      expect(first.reason).toBe('late_payment_conflict')

      // The family doesn't pay again, so the newer draft ends and no other order is active
      const ended = await store.cancelOrder(newer.registration_id, order.family.householdId, null)
      expect(ended.result).toBe('cancelled')
      return { order, ready, first }
    }

    async function expectCaseKeptAndNothingElseChanged(
      order: DraftOrderFixture,
      ready: Ready,
      supportRef: string
    ) {
      const tables = await paymentTables()
      const again = await store.confirmOrderPayment(payment(order, ready))
      expect(again).toMatchObject({ result: 'exception', reason: 'late_payment_conflict', support_ref: supportRef })

      expect(await orderRow(order.registrationId)).toMatchObject({ status: 'expired', paid_at: null, confirmation_number: null })
      expect(await counts(order.registrationId)).toEqual({ snapshots: 0, emails: 0, numbers: 0, cases: 1 })
      // No new case, no alert, no confirmation email anywhere
      expect(await paymentTables()).toEqual(tables)
    }

    it('is never confirmed on a later sync, even when no other order is active any more', async () => {
      const { order, ready, first } = await conflictThenNewerOrderEnds()
      await expectCaseKeptAndNothingElseChanged(order, ready, first.support_ref)
    })

    it('stays unconfirmed after the case is resolved, for example refunded', async () => {
      const { order, ready, first } = await conflictThenNewerOrderEnds()
      await asService(db.pool, (c) =>
        c.query(
          `UPDATE payment_exceptions SET status = 'resolved', resolution = 'refunded', resolved_at = now()
           WHERE registration_id = $1 AND reason = 'late_payment_conflict'`,
          [order.registrationId]
        ))
      await expectCaseKeptAndNothingElseChanged(order, ready, first.support_ref)
    })
  })

  it('never loses a late payment that races a new Submit', async () => {
    for (let round = 0; round < 5; round++) {
      const order = await createDraftOrder(db.pool)
      const ready = await readyToPay(db.pool, order)
      await store.expireCheckout({ registrationId: order.registrationId, claimId: ready.claimId, sessionId: ready.sessionId, account: ready.config.account })
      const [created, confirmed] = await Promise.all([
        store.createOrder(order.family.householdId, order.listing.listing.id,
          buildPayload({ listing: order.listing, dancers: order.dancers, entries: order.entries })),
        store.confirmOrderPayment(payment(order, ready)),
      ])
      // Submit read no paid order, so once the late payment is confirmed its price no longer holds
      const confirmedWins = confirmed.result === 'confirmed' && created.status === 'refused' &&
        created.reason === 'paid_orders_changed'
      const submitWins = created.status === 'created' && confirmed.result === 'exception' && confirmed.reason === 'late_payment_conflict'
      expect(confirmedWins || submitWins).toBe(true)
      // Both take the household-and-feis lock, so the late payment sees a Submit that won
      if (submitWins && created.status === 'created') {
        expect((await conflictDetails(order.registrationId)).why).toEqual([
          { rule: 'unpaid_order_exists', orders: [created.registration_id] }
        ])
      }
    }
  })

  it('records a case for a payment against a cancelled order', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    await store.cancelOrder(order.registrationId, order.family.householdId, ready.claimId)
    expect(await store.confirmOrderPayment(payment(order, ready))).toMatchObject({ result: 'exception', reason: 'order_not_payable' })
  })

  it('records a case when the order does not exist', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const missing = randomUUID()
    const result = await store.confirmOrderPayment(payment(order, ready, { registrationId: missing, sessionId: 'cs_orphan' }))
    expect(result).toMatchObject({ result: 'exception', reason: 'order_not_found' })
    const { rows } = await db.pool.query(`SELECT registration_id, details FROM payment_exceptions WHERE stripe_checkout_session_id = 'cs_orphan'`)
    expect(rows[0].registration_id).toBeNull()
    expect(rows[0].details.claimed_registration_id).toBe(missing)
  })

  it('rolls everything back when a step fails, and a retry then succeeds', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    await db.pool.query(`
      CREATE OR REPLACE FUNCTION public.numbering_is_down() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'numbering is down'; END $$;
      CREATE TRIGGER numbering_is_down BEFORE INSERT ON pre_registration.competitor_numbers
        FOR EACH ROW EXECUTE FUNCTION public.numbering_is_down();`)
    try {
      expect(await refused(store.confirmOrderPayment(payment(order, ready)))).toMatch(/numbering is down/)
      expect((await orderRow(order.registrationId)).status).toBe('pending_payment')
      expect(await counts(order.registrationId)).toEqual({ snapshots: 0, emails: 0, numbers: 0, cases: 0 })
    } finally {
      await db.pool.query('DROP TRIGGER numbering_is_down ON pre_registration.competitor_numbers')
    }
    expect((await store.confirmOrderPayment(payment(order, ready))).result).toBe('confirmed')
  })

  it('lets an unrelated uniqueness failure roll back for a retry instead of calling it a conflict', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    await db.pool.query(`
      CREATE OR REPLACE FUNCTION public.fake_unique_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE unique_violation USING MESSAGE = 'duplicate key in some other table', CONSTRAINT = 'some_other_unique'; END $$;
      CREATE TRIGGER fake_unique_failure BEFORE INSERT ON pre_registration.registration_snapshots
        FOR EACH ROW EXECUTE FUNCTION public.fake_unique_failure();`)
    try {
      expect(await refused(store.confirmOrderPayment(payment(order, ready)))).toMatch(/duplicate key in some other table/)
      expect(await counts(order.registrationId)).toEqual({ snapshots: 0, emails: 0, numbers: 0, cases: 0 })
    } finally {
      await db.pool.query('DROP TRIGGER fake_unique_failure ON pre_registration.registration_snapshots')
    }
  })

  it('confirms, and flags it, when the feis has since switched Stripe accounts', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    await db.pool.query(`UPDATE feis_listings SET stripe_account_id = 'acct_new' WHERE id = $1`, [order.listing.listing.id])
    expect((await store.confirmOrderPayment(payment(order, ready))).result).toBe('confirmed')
    const { rows } = await db.pool.query(`SELECT severity, reason FROM payment_exceptions WHERE registration_id = $1`, [order.registrationId])
    expect(rows).toEqual([{ severity: 'notice', reason: 'listing_account_changed' }])
  })
})

describe('record_payment_failure', () => {
  it('records a failed payment and frees the family to try again; ignores a mismatched notice', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const base = { registrationId: order.registrationId, claimId: ready.claimId, sessionId: ready.sessionId, eventId: 'evt_fail' }
    expect(await store.recordPaymentFailure({ ...base, account: 'acct_other' })).toEqual({ result: 'ignored' })
    expect(await store.recordPaymentFailure({ ...base, account: ready.config.account })).toMatchObject({ result: 'recorded' })
    expect((await orderRow(order.registrationId)).status).toBe('expired')
  })

  it.each<[string, { claimId?: string | null; sessionId?: string }]>([
    ['another claim', { claimId: randomUUID() }],
    ['no claim', { claimId: null }],
    ['another session', { sessionId: 'cs_someone_else' }]
  ])('ignores a failure notice naming %s, and leaves the order as it is', async (_, mismatch) => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const notice = {
      registrationId: order.registrationId,
      claimId: ready.claimId,
      sessionId: ready.sessionId,
      account: ready.config.account,
      eventId: `evt_${randomUUID()}`,
      ...mismatch
    }
    expect(await store.recordPaymentFailure(notice)).toEqual({ result: 'ignored' })
    expect((await orderRow(order.registrationId)).status).toBe('pending_payment')
    expect((await counts(order.registrationId)).cases).toBe(0)
  })
})

describe('what parents can see', () => {
  it('shows a parent only a restricted view of their own family-facing cases', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    await store.confirmOrderPayment(payment(order, ready, { amountCents: 1 }))
    await store.confirmOrderPayment(payment(order, ready, { account: 'acct_other' })) // admin-only reason

    const mine = await asParent(db.pool, order.family.userId, async (c) =>
      (await c.query('SELECT get_my_payment_reviews(NULL) AS reviews')).rows[0].reviews)
    expect(mine).toHaveLength(1)
    expect(Object.keys(mine[0]).sort()).toEqual(['created_at', 'message_code', 'registration_id', 'resolved', 'support_ref'])
    expect(mine[0]).toMatchObject({ registration_id: order.registrationId, message_code: 'A', resolved: false })

    const stranger = await createDraftOrder(db.pool)
    const theirs = await asParent(db.pool, stranger.family.userId, async (c) =>
      (await c.query('SELECT get_my_payment_reviews(NULL) AS reviews')).rows[0].reviews)
    expect(theirs).toEqual([])
  })

  it('keeps payment data from parents and anon, and internal steps from the server', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const before = await orderRow(order.registrationId)
    const tables = await paymentTables()
    for (const sql of [
      'SELECT * FROM payment_exceptions',
      'SELECT * FROM notifications',
      `SELECT confirm_order_payment('${order.registrationId}', NULL, 'cs', 'acct', 1, 'usd', 'paid', 'pi', NULL, 'evt', 'webhook')`,
    ]) {
      expect(await refused(asParent(db.pool, order.family.userId, (c) => c.query(sql)))).toMatch(/permission denied/)
    }

    // A parent can't record a failure and a visitor can't read the parent view. Not even the
    // service role may run the steps that fulfil an order or record a case, except through
    // confirm_order_payment and record_payment_failure. Each write would change something if run.
    const id = order.registrationId
    const { claimId, sessionId } = ready
    const account = ready.config.account
    const attempts: [DbRole, string, RegExp][] = [
      [
        'authenticated',
        `SELECT record_payment_failure('${id}', '${claimId}', '${sessionId}', '${account}', 'e')`,
        /permission denied for function record_payment_failure/
      ],
      [
        'anon',
        'SELECT get_my_payment_reviews(NULL)',
        /permission denied for function get_my_payment_reviews/
      ],
      [
        'service_role',
        `SELECT _fulfil_order('${id}', '${sessionId}', 'pi_internal', 'ch_internal', 4000, 'usd')`,
        /permission denied for function _fulfil_order/
      ],
      [
        'service_role',
        `SELECT _record_payment_exception('blocking', 'payment_failed', '${id}', '${claimId}',
           'evt_internal', '${account}', '${sessionId}', NULL, NULL, NULL, '{}')`,
        /permission denied for function _record_payment_exception/
      ]
    ]
    for (const [role, sql, denied] of attempts) {
      const userId = role === 'authenticated' ? order.family.userId : null
      expect(await refused(asRole(db.pool, role, userId, (c) => c.query(sql)))).toMatch(denied)
    }

    expect(await orderRow(order.registrationId)).toEqual(before)
    expect(await paymentTables()).toEqual(tables)
  })

  it('keeps the counted-orders steps from every API role, and confirm_free_order from parents and anon', async () => {
    // A $0 draft, so confirm_free_order would confirm it if a role could run it
    const created = await createListing(db.pool)
    await db.pool.query(
      'UPDATE fee_schedules SET event_fee_cents = 0, solo_fee_cents = 0 WHERE feis_listing_id = $1',
      [created.listing.id]
    )
    const free = await createDraftOrder(db.pool, {
      listing: {
        ...created,
        feeSchedule: { ...created.feeSchedule, event_fee_cents: 0, solo_fee_cents: 0 }
      }
    })
    expect(free.payload.total_cents).toBe(0)
    const id = free.registrationId
    const household = free.family.householdId
    const feis = free.listing.listing.id
    const before = await orderRow(id)
    const tables = await paymentTables()

    const roles: DbRole[] = ['authenticated', 'anon', 'service_role']
    const attempts: [DbRole, string, RegExp][] = [
      ...roles.flatMap((role): [DbRole, string, RegExp][] => [
        [role, `SELECT _counted_orders('${household}', '${feis}')`, /permission denied for function _counted_orders/],
        [role, `SELECT _uncounted_paid_orders('${id}')`, /permission denied for function _uncounted_paid_orders/]
      ]),
      ...roles.slice(0, 2).map((role): [DbRole, string, RegExp] => [
        role,
        `SELECT confirm_free_order('${id}', '${household}')`,
        /permission denied for function confirm_free_order/
      ])
    ]
    for (const [role, sql, denied] of attempts) {
      const userId = role === 'authenticated' ? free.family.userId : null
      expect(await refused(asRole(db.pool, role, userId, (c) => c.query(sql))), `${role}: ${sql}`).toMatch(denied)
    }
    expect(await orderRow(id)).toEqual(before)
    expect(await counts(id)).toEqual({ snapshots: 0, emails: 0, numbers: 0, cases: 0 })
    expect(await paymentTables()).toEqual(tables)

    // The service role may run it, so the refusals above came from the grants and not from the order
    const { rows } = await asRole(db.pool, 'service_role', null, (c) =>
      c.query(`SELECT confirm_free_order('${id}', '${household}') AS result`))
    expect(rows[0].result).toMatchObject({ result: 'confirmed' })
  })
})

describe('the unique keys confirmation relies on (migration 012)', () => {
  it('lets one payment intent pay only one order, even when two confirmations race', async () => {
    const first = await createDraftOrder(db.pool)
    const firstReady = await readyToPay(db.pool, first)
    const second = await createDraftOrder(db.pool)
    const secondReady = await readyToPay(db.pool, second)
    const shared = `pi_shared_${randomUUID().slice(0, 8)}`
    const p = payment(first, firstReady, { paymentIntentId: shared })

    // The first confirmation is still open when the second checks for reuse, so only the unique index
    // on stripe_payment_intent_id can stop the second one
    const client = await db.pool.connect()
    let racing: Promise<string> | undefined
    try {
      await client.query('BEGIN')
      await client.query(`SELECT set_config('role', 'service_role', true)`)
      const { rows } = await client.query(
        'SELECT confirm_order_payment($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) AS result',
        [p.registrationId, p.claimId, p.sessionId, p.account, p.amountCents, p.currency, p.paymentStatus,
         p.paymentIntentId, p.chargeId, p.eventId, p.source])
      expect(rows[0].result.result).toBe('confirmed')
      racing = refused(store.confirmOrderPayment(payment(second, secondReady, { paymentIntentId: shared })))
      await someoneIsWaiting()
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally {
      client.release()
    }
    expect(await racing).toMatch(/idx_registrations_payment_intent_unique/)

    const { rows: holders } = await db.pool.query('SELECT id FROM registrations WHERE stripe_payment_intent_id = $1', [shared])
    expect(holders).toEqual([{ id: first.registrationId }])
    expect((await orderRow(second.registrationId)).status).toBe('pending_payment')
    expect(await counts(second.registrationId)).toEqual({ snapshots: 0, emails: 0, numbers: 0, cases: 0 })
    // Stripe retries the second delivery, which the reuse check now records as a case
    expect(await store.confirmOrderPayment(payment(second, secondReady, { paymentIntentId: shared })))
      .toMatchObject({ result: 'exception', reason: 'payment_reused' })
  })

  it('never lets two orders share a checkout session', async () => {
    const first = await createDraftOrder(db.pool)
    const firstReady = await readyToPay(db.pool, first)
    const second = await createDraftOrder(db.pool)
    const secondReady = await readyToPay(db.pool, second, { attach: false })
    // A payment on the second order's own claim that names the first order's session would attach that
    // session to the second order too, when it marks it paid
    expect(await refused(store.confirmOrderPayment(payment(second, secondReady, { sessionId: firstReady.sessionId }))))
      .toMatch(/idx_registrations_checkout_session_unique/)
    expect(await refused(store.attachCheckoutSession(second.registrationId, secondReady.claimId, firstReady.sessionId)))
      .toMatch(/idx_registrations_checkout_session_unique/)
    expect(await orderRow(second.registrationId)).toMatchObject({ status: 'draft', stripe_checkout_session_id: null })
    expect(await counts(second.registrationId)).toEqual({ snapshots: 0, emails: 0, numbers: 0, cases: 0 })
  })

  it('keeps one snapshot per order, even inside the transaction that paid it', async () => {
    const order = await createDraftOrder(db.pool)
    await readyToPay(db.pool, order)
    // _fulfil_order's steps with the snapshot written twice: the guard lets both through, so the index decides
    const message = await refused(asService(db.pool, async (c) => {
      await c.query(`SELECT set_config('pre_registration.fulfilling_order', $1, true)`, [order.registrationId])
      await c.query(
        `UPDATE registrations SET status = 'paid', paid_at = now(), confirmation_number = 'RF-TEST-TWICE',
           stripe_payment_intent_id = 'pi_twice'
         WHERE id = $1`, [order.registrationId])
      await c.query(`INSERT INTO registration_snapshots (registration_id, snapshot_data) VALUES ($1, '{}')`, [order.registrationId])
      return c.query(`INSERT INTO registration_snapshots (registration_id, snapshot_data) VALUES ($1, '{}')`, [order.registrationId])
    }))
    expect(message).toMatch(/idx_registration_snapshots_one_per_order/)
    expect((await orderRow(order.registrationId)).status).toBe('pending_payment')
    expect(await counts(order.registrationId)).toEqual({ snapshots: 0, emails: 0, numbers: 0, cases: 0 })
  })
})

describe('confirmation numbers', () => {
  it("take their year from Eastern time, so a payment on New Year's Eve in Boston keeps the old year", async () => {
    // 03:00 UTC on 1 January is 10pm on 31 December in Boston; 05:30 UTC is half past midnight there
    const { rows: [numbers] } = await db.pool.query(`
      SELECT new_confirmation_number('2027-01-01T03:00:00Z') AS new_years_eve,
             new_confirmation_number('2027-01-01T05:30:00Z') AS new_years_day`)
    expect(numbers.new_years_eve).toMatch(/^RF-2026-[A-HJKMNP-Z2-9]{5}$/)
    expect(numbers.new_years_day).toMatch(/^RF-2027-[A-HJKMNP-Z2-9]{5}$/)
  })
})
