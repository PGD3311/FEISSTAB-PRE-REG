import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOrderStore, type ConfirmPaymentInput, type OrderStore } from '@/app/_payments/order-store'
import { asParent, asRole, asService, createTestDatabase, refused, type TestDatabase } from './helpers/db'
import { buildPayload, createDraftOrder, readyToPay, type DraftOrderFixture } from './helpers/fixtures'
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
    registrationId: order.registrationId, claimId: ready.claimId, sessionId: ready.sessionId, account: ready.config.account,
    amountCents: order.payload.total_cents, currency: 'usd', paymentStatus: 'paid', paymentIntentId: `pi_${ready.sessionId}`,
    chargeId: null, eventId: `evt_${randomUUID()}`, source: 'webhook', ...overrides,
  }
}

/** A late payment on an expired order, after the family started a newer one */
async function lateConflict(newer: 'unclaimed' | 'claimed' | 'paid' = 'unclaimed') {
  const order = await createDraftOrder(db.pool)
  const ready = await readyToPay(db.pool, order)
  await store.expireCheckout({ registrationId: order.registrationId, claimId: ready.claimId, sessionId: ready.sessionId, account: ready.config.account })

  const payload = buildPayload({ listing: order.listing, dancers: order.dancers, entries: order.entries })
  const created = await store.createOrder(order.family.householdId, order.listing.listing.id, payload)
  if (created.status !== 'created') throw new Error('expected a newer order')
  const newerOrder: DraftOrderFixture = { ...order, payload, registrationId: created.registration_id }
  if (newer !== 'unclaimed') {
    const newerReady = await readyToPay(db.pool, newerOrder)
    if (newer === 'paid') await store.confirmOrderPayment(payment(newerOrder, newerReady))
  }

  const result = await store.confirmOrderPayment(payment(order, ready))
  if (result.result !== 'exception') throw new Error('expected a late-payment case')
  return { order, newerId: created.registration_id, supportRef: result.support_ref }
}

async function statusOf(id: string) {
  const { rows } = await db.pool.query('SELECT status FROM registrations WHERE id = $1', [id])
  return rows[0].status
}

const confirmLate = (ref: string, note = 'Family paid late; spoke to them by phone') =>
  db.pool.query('SELECT payments_admin.confirm_late_payment($1, $2) AS result', [ref, note])

describe('payments_admin.confirm_late_payment', () => {
  it('confirms the late payment, cancels the newer unpaid order, resolves the case and keeps an audit row', async () => {
    const { order, newerId, supportRef } = await lateConflict()
    const { rows } = await confirmLate(supportRef)
    expect(rows[0].result).toMatchObject({ result: 'confirmed', cancelled_orders: [newerId] })
    expect(await statusOf(order.registrationId)).toBe('paid')
    expect(await statusOf(newerId)).toBe('cancelled')

    const { rows: [caseRow] } = await db.pool.query('SELECT status, resolution, resolved_by FROM payment_exceptions WHERE support_ref = $1', [supportRef])
    expect(caseRow).toMatchObject({ status: 'resolved', resolution: 'confirmed_late_payment', resolved_by: 'postgres' })
    const { rows: [audit] } = await db.pool.query('SELECT action, note, evidence FROM admin_actions WHERE support_ref = $1', [supportRef])
    expect(audit).toMatchObject({ action: 'confirm_late_payment', note: 'Family paid late; spoke to them by phone' })
    expect(audit.evidence.cancelled_orders).toEqual([newerId])

    // paid_at is when the case was confirmed, after it was recorded, and the numbers were assigned then
    const { rows: [timing] } = await db.pool.query(
      `SELECT r.paid_at > e.created_at AS paid_at_is_confirmation,
              (SELECT count(*)::int FROM competitor_numbers c WHERE c.registration_id = r.id) AS numbers
       FROM registrations r JOIN payment_exceptions e ON e.registration_id = r.id
       WHERE e.support_ref = $1`, [supportRef])
    expect(timing).toEqual({ paid_at_is_confirmation: true, numbers: 1 })
  })

  it('refuses when another order was taken to checkout, even once that checkout has expired', async () => {
    const { supportRef, newerId } = await lateConflict('claimed')
    expect(await refused(confirmLate(supportRef))).toMatch(/was taken to checkout/)

    // The newer order's checkout runs out, but a delayed payment for it could still arrive
    const { rows: [newer] } = await db.pool.query(
      'SELECT checkout_claim_id, stripe_checkout_session_id, checkout_config FROM registrations WHERE id = $1', [newerId])
    await store.expireCheckout({
      registrationId: newerId, claimId: newer.checkout_claim_id, sessionId: newer.stripe_checkout_session_id,
      account: newer.checkout_config.account,
    })
    expect(await refused(confirmLate(supportRef))).toMatch(/was taken to checkout/)
  })

  it('refuses when the family paid twice; that case is closed with a refund', async () => {
    const { supportRef } = await lateConflict('paid')
    expect(await refused(confirmLate(supportRef))).toMatch(/refund one payment instead/)
  })

  it('refuses when the recorded payment does not match the order', async () => {
    const { supportRef } = await lateConflict()
    await db.pool.query('UPDATE payment_exceptions SET amount_cents = 1 WHERE support_ref = $1', [supportRef])
    expect(await refused(confirmLate(supportRef))).toMatch(/does not match/)
  })

  it('only confirms late-payment cases, and needs a note', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const wrong = await store.confirmOrderPayment(payment(order, ready, { amountCents: 1 }))
    if (wrong.result !== 'exception') throw new Error('expected a case')
    expect(await refused(confirmLate(wrong.support_ref))).toMatch(/resolved by a refund/)

    const { supportRef } = await lateConflict()
    expect(await refused(confirmLate(supportRef, '  '))).toMatch(/note/)
  })
})

describe('payments_admin.close_exception', () => {
  it('allows only the closings each reason permits, and records them', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const wrong = await store.confirmOrderPayment(payment(order, ready, { amountCents: 1 }))
    if (wrong.result !== 'exception') throw new Error('expected a case')
    const close = (resolution: string, refund: string | null) =>
      db.pool.query('SELECT payments_admin.close_exception($1, $2, $3, $4) AS result',
        [wrong.support_ref, resolution, refund, 'Refunded in Stripe after checking'])

    expect(await refused(close('refunded', null))).toMatch(/refund ID/)
    expect(await refused(close('no_action', null))).toMatch(/only failed payments/)
    expect((await close('refunded', 're_3QabcDEF')).rows[0].result).toEqual({ result: 'resolved', resolution: 'refunded' })
    expect(await refused(close('refunded', 're_3QabcDEF'))).toMatch(/already resolved/)

    const { rows } = await db.pool.query(`SELECT evidence FROM admin_actions WHERE support_ref = $1`, [wrong.support_ref])
    expect(rows[0].evidence).toEqual({ resolution: 'refunded', stripe_refund_id: 're_3QabcDEF' })
  })

  it('closes a reused-payment case with no action when there is no second charge, and leaves both orders alone', async () => {
    // The payment intent belongs to the first order, which is paid and confirmed: refunding it would refund that order
    const first = await createDraftOrder(db.pool)
    const firstReady = await readyToPay(db.pool, first)
    await store.confirmOrderPayment(payment(first, firstReady))
    const second = await createDraftOrder(db.pool)
    const secondReady = await readyToPay(db.pool, second)
    const reused = await store.confirmOrderPayment(
      payment(second, secondReady, { paymentIntentId: `pi_${firstReady.sessionId}` }))
    if (reused.result !== 'exception' || reused.reason !== 'payment_reused') throw new Error('expected a reused-payment case')

    const note = 'Daniel: checked Stripe; one charge only, on the first order'
    const { rows: [closed] } = await db.pool.query(
      'SELECT payments_admin.close_exception($1, $2, $3, $4) AS result', [reused.support_ref, 'no_action', null, note])
    expect(closed.result).toEqual({ result: 'resolved', resolution: 'no_action' })

    const { rows: [caseRow] } = await db.pool.query(
      'SELECT status, resolution, resolved_by FROM payment_exceptions WHERE support_ref = $1', [reused.support_ref])
    expect(caseRow).toEqual({ status: 'resolved', resolution: 'no_action', resolved_by: 'postgres' })
    const { rows: audit } = await db.pool.query(
      'SELECT action, registration_id, actor, note, evidence FROM admin_actions WHERE support_ref = $1', [reused.support_ref])
    expect(audit).toEqual([{ action: 'close_exception', registration_id: second.registrationId, actor: 'postgres', note,
      evidence: { resolution: 'no_action', stripe_refund_id: null } }])

    const { rows: orders } = await db.pool.query(
      'SELECT id, status, stripe_payment_intent_id FROM registrations WHERE id = ANY($1) ORDER BY created_at', [[first.registrationId, second.registrationId]])
    expect(orders).toEqual([
      { id: first.registrationId, status: 'paid', stripe_payment_intent_id: `pi_${firstReady.sessionId}` },
      { id: second.registrationId, status: 'pending_payment', stripe_payment_intent_id: null }])
    expect(await refused(db.pool.query('SELECT payments_admin.close_exception($1, $2, $3, $4)', [reused.support_ref, 'no_action', null, note])))
      .toMatch(/already resolved/)
  })
})

describe('who can reach the admin functions', () => {
  it('refuses parents, anon and the service role', async () => {
    const { family } = await createDraftOrder(db.pool)
    const sql = `SELECT payments_admin.close_exception('PAY-XXXXX', 'no_action', NULL, 'x')`
    expect(await refused(asParent(db.pool, family.userId, (c) => c.query(sql)))).toMatch(/permission denied for schema payments_admin/)
    expect(await refused(asRole(db.pool, 'anon', null, (c) => c.query(sql)))).toMatch(/permission denied for schema payments_admin/)
    expect(await refused(asService(db.pool, (c) => c.query(sql)))).toMatch(/permission denied for schema payments_admin/)
  })
})
