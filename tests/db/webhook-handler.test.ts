import { randomUUID } from 'node:crypto'
import type Stripe from 'stripe'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOrderStore, type OrderStore } from '@/app/_payments/order-store'
import { handleStripeEvent, type WebhookDeps } from '@/app/_payments/webhook-handler'
import { createTestDatabase, type TestDatabase } from './helpers/db'
import { FakeStripe } from './helpers/fake-stripe'
import { createDraftOrder, readyToPay, type DraftOrderFixture } from './helpers/fixtures'
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

function deps(log: string[] = []): WebhookDeps {
  return { store, stripe: new FakeStripe(), log: (line) => log.push(line) }
}

type Ready = Awaited<ReturnType<typeof readyToPay>>

function sessionFor(order: DraftOrderFixture, ready: Ready, overrides: Record<string, unknown> = {}) {
  return {
    object: 'checkout.session', id: ready.sessionId, status: 'complete', payment_status: 'paid',
    amount_total: order.payload.total_cents, currency: 'usd', payment_intent: `pi_${ready.sessionId}`,
    metadata: { registration_id: order.registrationId, claim_id: ready.claimId },
    ...overrides,
  }
}

function event(type: string, session: Record<string, unknown>, account = 'acct_test_feis', id = `evt_${randomUUID()}`): Stripe.Event {
  return { id, object: 'event', type, account, data: { object: session } } as unknown as Stripe.Event
}

async function status(id: string) {
  const { rows } = await db.pool.query('SELECT status FROM registrations WHERE id = $1', [id])
  return rows[0].status
}

describe('handleStripeEvent', () => {
  it('confirms a paid checkout, and treats a repeat delivery as done', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const paid = event('checkout.session.completed', sessionFor(order, ready))
    expect(await handleStripeEvent(deps(), paid)).toMatchObject({ status: 200, body: { result: 'confirmed' } })
    expect(await handleStripeEvent(deps(), paid)).toMatchObject({ status: 200, body: { result: 'already_confirmed' } })
    expect(await status(order.registrationId)).toBe('paid')
  })

  it('waits on a checkout that completed without payment', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const outcome = await handleStripeEvent(deps(), event('checkout.session.completed', sessionFor(order, ready, { payment_status: 'unpaid' })))
    expect(outcome).toMatchObject({ status: 200, body: { waiting: true } })
    expect(await status(order.registrationId)).toBe('pending_payment')
  })

  it("quietly ignores an organiser's own Stripe sales", async () => {
    const before = await db.pool.query('SELECT (SELECT count(*)::int FROM payment_exceptions) AS cases, (SELECT count(*)::int FROM notifications) AS alerts')
    for (const metadata of [{}, { registration_id: 'not-a-uuid' }]) {
      const outcome = await handleStripeEvent(deps(), event('checkout.session.completed', {
        object: 'checkout.session', id: 'cs_other_sale', payment_status: 'paid', amount_total: 2500, currency: 'usd', metadata,
      }))
      expect(outcome).toMatchObject({ status: 200, body: { ignored: 'not a RunFeis checkout' } })
    }
    const after = await db.pool.query('SELECT (SELECT count(*)::int FROM payment_exceptions) AS cases, (SELECT count(*)::int FROM notifications) AS alerts')
    expect(after.rows[0]).toEqual(before.rows[0])
  })

  it('records a case for a payment from the wrong account', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const log: string[] = []
    const outcome = await handleStripeEvent(deps(log), event('checkout.session.completed', sessionFor(order, ready), 'acct_other'))
    expect(outcome).toMatchObject({ status: 200, body: { result: 'exception', reason: 'account_mismatch' } })
    expect(log.some((line) => line.startsWith('[PAYMENT_EXCEPTION] PAY-'))).toBe(true)
    expect(await status(order.registrationId)).toBe('pending_payment')
  })

  it('records a failed payment and frees the family', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const outcome = await handleStripeEvent(deps(), event('checkout.session.async_payment_failed', sessionFor(order, ready, { payment_status: 'unpaid' })))
    expect(outcome).toMatchObject({ status: 200, body: { result: 'recorded' } })
    expect(await status(order.registrationId)).toBe('expired')
  })

  it('logs a failure notice that does not match the order, and changes nothing', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const log: string[] = []
    const before = await db.pool.query(
      'SELECT (SELECT count(*)::int FROM payment_exceptions) AS cases, (SELECT count(*)::int FROM notifications) AS alerts')
    const outcome = await handleStripeEvent(deps(log), event('checkout.session.async_payment_failed',
      sessionFor(order, ready, { id: 'cs_old', payment_status: 'unpaid' })))
    expect(outcome).toMatchObject({ status: 200, body: { result: 'ignored' } })
    expect(log).toEqual([`[WEBHOOK] payment failure of cs_old ignored: no order with this claim, account and session`])
    const after = await db.pool.query(
      'SELECT (SELECT count(*)::int FROM payment_exceptions) AS cases, (SELECT count(*)::int FROM notifications) AS alerts')
    expect(after.rows[0]).toEqual(before.rows[0])
    expect(await status(order.registrationId)).toBe('pending_payment')
  })

  it("expires only the order's own checkout, and never a paid order", async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    expect(await handleStripeEvent(deps(), event('checkout.session.expired', sessionFor(order, ready, { id: 'cs_old', status: 'expired' }))))
      .toMatchObject({ body: { result: 'ignored', why: 'mismatch' } })
    expect(await handleStripeEvent(deps(), event('checkout.session.expired', sessionFor(order, ready, { status: 'expired' }))))
      .toMatchObject({ body: { result: 'expired' } })

    const paidOrder = await createDraftOrder(db.pool)
    const paidReady = await readyToPay(db.pool, paidOrder)
    await handleStripeEvent(deps(), event('checkout.session.completed', sessionFor(paidOrder, paidReady)))
    expect(await handleStripeEvent(deps(), event('checkout.session.expired', sessionFor(paidOrder, paidReady, { status: 'expired' }))))
      .toMatchObject({ body: { result: 'ignored', why: 'not_open' } })
    expect(await status(paidOrder.registrationId)).toBe('paid')
  })

  it('asks Stripe to retry when the database step fails', async () => {
    const order = await createDraftOrder(db.pool)
    const ready = await readyToPay(db.pool, order)
    const broken: WebhookDeps = { ...deps(), store: { ...store, confirmOrderPayment: async () => { throw new Error('database is down') } } }
    expect(await handleStripeEvent(broken, event('checkout.session.completed', sessionFor(order, ready))))
      .toMatchObject({ status: 500 })
  })
})
