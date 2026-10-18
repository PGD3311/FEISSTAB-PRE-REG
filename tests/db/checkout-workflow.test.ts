import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  cancel,
  CHECKOUT_MESSAGES,
  pay,
  payResultFromConfirmation,
  syncConfirmation,
  type CheckoutDeps,
  type PayResult
} from '@/app/_payments/checkout-workflow'
import { createOrderStore, type FreeOrderResult, type OrderStore } from '@/app/_payments/order-store'
import { CHECKOUT_BLOCK_MESSAGES, PAID_ORDERS_CHANGED_MESSAGE } from '@/lib/engine/checkout-policy'
import { reviewMessage } from '@/lib/payment-review-messages'
import { asService, createTestDatabase, type TestDatabase } from './helpers/db'
import { FakeStripe } from './helpers/fake-stripe'
import {
  buildPayload,
  checkoutConfigFor,
  createDraftOrder,
  createListing,
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

function deps(stripe: FakeStripe, overrides: Partial<CheckoutDeps> = {}): CheckoutDeps {
  return {
    store, stripe, now: () => new Date(), wait: async () => undefined,
    baseUrl: 'https://runfeis.test', newClaimId: () => randomUUID(),
    ...overrides,
  }
}

/** A clock this many minutes ahead of the database, as if the family came back later */
const minutesLater = (minutes: number) => () => new Date(Date.now() + minutes * 60_000)

const ids = (order: DraftOrderFixture) => ({ registrationId: order.registrationId, householdId: order.family.householdId })

/** Stripe may have the money but confirmation isn't finished: message C, on the success page */
const CHECKING = { kind: 'checking', message: reviewMessage('C', null) }

/** What Pay returns for the nth checkout this fake Stripe made */
const checkoutPage = (stripe: FakeStripe, n = 1) =>
  ({ kind: 'redirect', url: `https://checkout.stripe.test/${stripe.sessionId(n)}` })

async function orderRow(id: string) {
  const { rows } = await db.pool.query('SELECT * FROM registrations WHERE id = $1', [id])
  return rows[0]
}

/** A store whose attach step dies, like a Pay request that stopped after Stripe made the session */
const crashingAttach = (): OrderStore => ({ ...store, attachCheckoutSession: async () => { throw new Error('crashed') } })

/** Claims checkout the way Pay does, without making a session: a Pay that stopped right after claiming */
async function claimOnly(order: DraftOrderFixture) {
  const claimId = randomUUID()
  const config = checkoutConfigFor(order, claimId)
  const claim = await store.claimCheckout({
    registrationId: order.registrationId, householdId: order.family.householdId, claimId, config,
  })
  if (claim.result !== 'claimed') throw new Error('expected a claim')
  return { claimId, config }
}

describe('pay', () => {
  it('creates one checkout and moves the order to pending_payment', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    expect(await pay(deps(stripe), ids(order))).toEqual(checkoutPage(stripe))
    const row = await orderRow(order.registrationId)
    expect(row).toMatchObject({ status: 'pending_payment', stripe_checkout_session_id: stripe.sessionId() })
    expect(row.checkout_config.payment_method_types).toEqual(['card'])
    expect(stripe.sessions.size).toBe(1)
  })

  it('gives two simultaneous clicks one claim and one session', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    const [a, b] = await Promise.all([pay(deps(stripe), ids(order)), pay(deps(stripe), ids(order))])
    expect(a).toEqual(b)
    expect(a.kind).toBe('redirect')
    expect(stripe.sessionsFor(order.registrationId)).toHaveLength(1)
  })

  it('resumes the same session after the family backs out of Stripe', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    const first = await pay(deps(stripe), ids(order))
    expect(await pay(deps(stripe), ids(order))).toEqual(first)
    expect(stripe.createCalls).toBe(1)
  })

  it('recovers a session Stripe made before an earlier Pay stopped', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    expect(await pay({ ...deps(stripe), store: crashingAttach() }, ids(order)).catch(() => null)).toBeNull()
    expect((await orderRow(order.registrationId)).stripe_checkout_session_id).toBeNull()

    expect(await pay(deps(stripe), ids(order))).toEqual(checkoutPage(stripe))
    expect(stripe.sessionsFor(order.registrationId)).toHaveLength(1)
    expect((await orderRow(order.registrationId)).stripe_checkout_session_id).toBe(stripe.sessionId())
  })

  it('finds an unattached session by listing, sending no create, past the deadline', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    // Pay made the session, then stopped before attaching it
    const crashing = { ...deps(stripe), store: crashingAttach() }
    expect(await pay(crashing, ids(order)).catch(() => null)).toBeNull()
    expect(stripe.createCalls).toBe(1)

    // 7 minutes on: too late to replay the create, so Pay lists the claim's sessions instead
    const later = deps(stripe, { now: minutesLater(7) })
    expect(await pay(later, ids(order))).toEqual(checkoutPage(stripe))
    expect(stripe.createCalls).toBe(1)
    expect(stripe.sessionsFor(order.registrationId)).toHaveLength(1)
    expect(await orderRow(order.registrationId)).toMatchObject({
      status: 'pending_payment',
      stripe_checkout_session_id: stripe.sessionId()
    })
  })

  it('replays retryable failures with the identical request', async () => {
    const stripe = new FakeStripe()
    stripe.nextCreate = ['retry-before', 'retry-after']
    const order = await createDraftOrder(db.pool)
    expect((await pay(deps(stripe), ids(order))).kind).toBe('redirect')
    expect(stripe.createCalls).toBe(3)
    expect(stripe.sessionsFor(order.registrationId)).toHaveLength(1)
  })

  it('finds a session hidden behind a cached 500 by looking it up, and resumes it', async () => {
    const stripe = new FakeStripe()
    stripe.nextCreate = ['cached-500']
    const order = await createDraftOrder(db.pool)
    expect(await pay(deps(stripe), ids(order))).toEqual(checkoutPage(stripe))
    expect(stripe.createCalls).toBe(4)
    expect((await orderRow(order.registrationId)).stripe_checkout_session_id).toBe(stripe.sessionId())
  })

  it('waits instead of guessing while the same request is still in progress', async () => {
    const stripe = new FakeStripe()
    stripe.nextCreate = ['in-progress', 'in-progress', 'in-progress', 'in-progress']
    const order = await createDraftOrder(db.pool)
    expect(await pay(deps(stripe), ids(order))).toEqual({ kind: 'try_again', message: CHECKOUT_MESSAGES.starting })
    const row = await orderRow(order.registrationId)
    expect(row.status).toBe('draft')
    expect(row.checkout_claim_id).not.toBeNull()
  })

  it('reports a refusal without cancelling, and frees the family only once no session can exist', async () => {
    const stripe = new FakeStripe()
    stripe.nextCreate = ['reject']
    const order = await createDraftOrder(db.pool)
    expect(await pay(deps(stripe), ids(order))).toEqual({ kind: 'error', message: CHECKOUT_MESSAGES.couldNotStart })
    expect((await orderRow(order.registrationId)).status).toBe('draft')

    // 11 minutes on: no create request can still be running, and Stripe has no session for the claim
    expect((await pay(deps(stripe, { now: minutesLater(11) }), ids(order))).kind).toBe('start_again')
    expect((await orderRow(order.registrationId)).status).toBe('cancelled')
    expect(stripe.sessions.size).toBe(0)
  })

  it('sends no create request for a claim older than 5 minutes, and keeps the order while one may still be running', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await claimOnly(order) // Pay claimed, then stopped before making a session
    // 7 minutes on: past Pay's 5-minute create deadline, but before the 10 minutes after which none can be running
    expect(await pay(deps(stripe, { now: minutesLater(7) }), ids(order)))
      .toEqual({ kind: 'try_again', message: CHECKOUT_MESSAGES.starting })
    expect(stripe.createCalls).toBe(0)
    expect(stripe.sessionsFor(order.registrationId)).toHaveLength(0)
    const row = await orderRow(order.registrationId)
    expect(row.status).toBe('draft')
    expect(row.checkout_claim_id).not.toBeNull()
  })

  it('starts no checkout once the organiser closes registration, and leaves the order alone', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await db.pool.query(`UPDATE feis_listings SET status = 'closed' WHERE id = $1`, [order.listing.listing.id])
    expect(await pay(deps(stripe), ids(order)))
      .toEqual({ kind: 'blocked', message: 'Registration has been closed by the organiser.' })
    expect((await orderRow(order.registrationId)).checkout_claim_id).toBeNull()
  })

  it('lets a checkout claimed before the organiser closed registration finish', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    expect(await pay(deps(stripe), ids(order))).toEqual(checkoutPage(stripe))
    await db.pool.query(`UPDATE feis_listings SET status = 'closed' WHERE id = $1`, [
      order.listing.listing.id
    ])

    // The family comes back to the open checkout, not to "closed by the organiser"
    expect(await pay(deps(stripe), ids(order))).toEqual(checkoutPage(stripe))
    expect(stripe.createCalls).toBe(1)
    stripe.pay(stripe.sessionId())
    expect((await pay(deps(stripe), ids(order))).kind).toBe('paid')
  })

  it('lets a submitted order be paid after the deadline while registration stays open', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await db.pool.query(`UPDATE feis_listings SET reg_closes_at = now() - interval '1 minute' WHERE id = $1`, [order.listing.listing.id])
    expect((await pay(deps(stripe), ids(order))).kind).toBe('redirect')
  })

  it('asks the family to start again once the hold has passed', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await db.pool.query(`UPDATE registrations SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`, [order.registrationId])
    expect(await pay(deps(stripe), ids(order))).toEqual({ kind: 'start_again', message: CHECKOUT_MESSAGES.expired })
    expect(stripe.createCalls).toBe(0)
  })

  it('confirms when the family paid and comes back before the webhook', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await pay(deps(stripe), ids(order))
    stripe.pay(stripe.sessionId())
    const result = await pay(deps(stripe), ids(order))
    expect(result.kind).toBe('paid')
    if (result.kind === 'paid') expect(result.confirmationNumber).toMatch(/^RF-/)
  })

  it('says it is checking, and keeps the order, when the checkout completed unpaid', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await pay(deps(stripe), ids(order))
    stripe.completeUnpaid(stripe.sessionId())
    expect(await pay(deps(stripe), ids(order))).toEqual(CHECKING)
    expect((await orderRow(order.registrationId)).status).toBe('pending_payment')
    expect(stripe.createCalls).toBe(1)
  })

  it('settles a session that was paid while the order moved on, instead of trying to expire it', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    // While Pay is attaching, the family has already paid and the order's hold has run out
    const racing: OrderStore = {
      ...store,
      attachCheckoutSession: async (registrationId, claimId, sessionId) => {
        stripe.pay(sessionId)
        await store.expireCheckout({ registrationId, claimId, sessionId, account: 'acct_test_feis' })
        return store.attachCheckoutSession(registrationId, claimId, sessionId)
      },
    }
    expect((await pay({ ...deps(stripe), store: racing }, ids(order))).kind).toBe('paid')
    expect((await orderRow(order.registrationId)).status).toBe('paid')
  })
})

// Spec §6 step 3a: a $0 order is confirmed by the database, with no Stripe call and no claim
describe('pay for a $0 order', () => {
  /** A draft order at a feis where the family fee and every dance cost nothing */
  async function freeOrder(): Promise<DraftOrderFixture> {
    const created = await createListing(db.pool)
    await db.pool.query(
      'UPDATE fee_schedules SET event_fee_cents = 0, solo_fee_cents = 0 WHERE feis_listing_id = $1',
      [created.listing.id]
    )
    const listing = { ...created, feeSchedule: { ...created.feeSchedule, event_fee_cents: 0, solo_fee_cents: 0 } }
    const order = await createDraftOrder(db.pool, { listing })
    expect(order.payload.total_cents).toBe(0)
    return order
  }

  it('confirms it without Stripe, and a second click hears it is paid', async () => {
    const stripe = new FakeStripe()
    const order = await freeOrder()
    const first = await pay(deps(stripe), ids(order))
    if (first.kind !== 'paid') throw new Error(`expected paid, got ${first.kind}`)
    expect(first.confirmationNumber).toMatch(/^RF-\d{4}-[A-HJKMNP-Z2-9]{5}$/)
    expect(await pay(deps(stripe), ids(order))).toEqual(first)
    expect(stripe.createCalls).toBe(0)
    expect(await orderRow(order.registrationId)).toMatchObject({
      status: 'paid', checkout_claim_id: null, stripe_checkout_session_id: null
    })
  })

  it('is blocked once the organiser stops registration, and starts again once its hold has passed', async () => {
    const stripe = new FakeStripe()
    const stopped = await freeOrder()
    await db.pool.query(`UPDATE feis_listings SET status = 'closed' WHERE id = $1`, [stopped.listing.listing.id])
    expect(await pay(deps(stripe), ids(stopped)))
      .toEqual({ kind: 'blocked', message: CHECKOUT_BLOCK_MESSAGES.organiser_stopped })

    const lapsed = await freeOrder()
    await db.pool.query(`UPDATE registrations SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [lapsed.registrationId])
    expect(await pay(deps(stripe), ids(lapsed)))
      .toEqual({ kind: 'start_again', message: CHECKOUT_MESSAGES.expired })
    expect(stripe.createCalls).toBe(0)
    for (const order of [stopped, lapsed]) expect((await orderRow(order.registrationId)).status).toBe('draft')
  })

  // The database's own answers are pinned in the order-function tests; this pins what Pay tells the family
  // for each one, including the answers a single click can't reach (a repeat click finds the order paid
  // before it asks, and a cancel or an add-on race needs two requests at once)
  it('tells the family what each answer from confirm_free_order means', async () => {
    const stripe = new FakeStripe()
    const order = await freeOrder()
    const paidAs = (confirmationNumber: string): PayResult => ({ kind: 'paid', confirmationNumber })
    const answers: [FreeOrderResult, PayResult][] = [
      [{ result: 'confirmed', confirmation_number: 'RF-2026-AAAAA' }, paidAs('RF-2026-AAAAA')],
      [{ result: 'already_confirmed', confirmation_number: 'RF-2026-BBBBB' }, paidAs('RF-2026-BBBBB')],
      [{ result: 'blocked', reason: 'organiser_stopped' },
        { kind: 'blocked', message: CHECKOUT_BLOCK_MESSAGES.organiser_stopped }],
      [{ result: 'blocked', reason: 'competition_unavailable' },
        { kind: 'blocked', message: CHECKOUT_BLOCK_MESSAGES.competition_unavailable }],
      [{ result: 'paid_orders_changed', orders: [randomUUID()] },
        { kind: 'start_again', message: PAID_ORDERS_CHANGED_MESSAGE }],
      [{ result: 'not_confirmable', status: 'cancelled', hold_expired: false },
        { kind: 'start_again', message: CHECKOUT_MESSAGES.cancelled }],
      [{ result: 'not_confirmable', status: 'expired', hold_expired: true },
        { kind: 'start_again', message: CHECKOUT_MESSAGES.expired }],
      [{ result: 'not_confirmable', status: 'draft', hold_expired: true },
        { kind: 'start_again', message: CHECKOUT_MESSAGES.expired }],
      [{ result: 'not_found' }, { kind: 'error', message: CHECKOUT_MESSAGES.notFound }]
    ]
    for (const [answer, expected] of answers) {
      const asked: string[] = []
      const stubbed: OrderStore = {
        ...store,
        confirmFreeOrder: async (registrationId) => {
          asked.push(registrationId)
          return answer
        }
      }
      expect(await pay({ ...deps(stripe), store: stubbed }, ids(order))).toEqual(expected)
      expect(asked).toEqual([order.registrationId])
    }
    // Every answer came from confirm_free_order alone: no claim, no Stripe call, order untouched
    expect(stripe.createCalls).toBe(0)
    expect(await orderRow(order.registrationId)).toMatchObject({ status: 'draft', checkout_claim_id: null })
  })
})

describe('cancel', () => {
  it('cancels an unclaimed draft', async () => {
    const order = await createDraftOrder(db.pool)
    expect(await cancel(deps(new FakeStripe()), ids(order))).toEqual({ kind: 'cancelled' })
    expect((await orderRow(order.registrationId)).status).toBe('cancelled')
  })

  it('closes the Stripe page, and checks it closed, before cancelling during checkout', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await pay(deps(stripe), ids(order))
    expect(await cancel(deps(stripe), ids(order))).toEqual({ kind: 'cancelled' })
    expect(stripe.sessions.get(stripe.sessionId())?.status).toBe('expired')
    expect(() => stripe.pay(stripe.sessionId())).toThrow(/not open/)
  })

  it('confirms the payment instead of cancelling once the family has paid', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await pay(deps(stripe), ids(order))
    stripe.pay(stripe.sessionId())
    expect((await cancel(deps(stripe), ids(order))).kind).toBe('paid')
    expect((await orderRow(order.registrationId)).status).toBe('paid')
  })

  it('says it is checking, and keeps the order, when the checkout completed unpaid', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await pay(deps(stripe), ids(order))
    stripe.completeUnpaid(stripe.sessionId())
    expect(await cancel(deps(stripe), ids(order))).toEqual(CHECKING)
    expect((await orderRow(order.registrationId)).status).toBe('pending_payment')
  })

  it('says it is checking, and keeps the order, when confirming fails for now', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await pay(deps(stripe), ids(order))
    stripe.pay(stripe.sessionId())
    const confirmOrderPayment = async () => {
      throw new Error('database is down')
    }
    const broken = { ...deps(stripe), store: { ...store, confirmOrderPayment } }
    expect(await cancel(broken, ids(order))).toEqual(CHECKING)
    expect((await orderRow(order.registrationId)).status).toBe('pending_payment')
  })

  it('finds and closes a session that Pay never attached', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await pay({ ...deps(stripe), store: crashingAttach() }, ids(order)).catch(() => null)
    expect(await cancel(deps(stripe), ids(order))).toEqual({ kind: 'cancelled' })
    expect(stripe.sessions.get(stripe.sessionId())?.status).toBe('expired')
  })

  it('will not cancel while a session may still be being made, and cancels once it can', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await claimOnly(order) // Pay has claimed; its create request may still be running
    expect(await cancel(deps(stripe), ids(order))).toEqual({ kind: 'try_again', message: CHECKOUT_MESSAGES.cancelLater })
    expect((await orderRow(order.registrationId)).status).toBe('draft')

    // Pay finishes making the session, then the family cancels
    expect((await pay(deps(stripe), ids(order))).kind).toBe('redirect')
    expect(await cancel(deps(stripe), ids(order))).toEqual({ kind: 'cancelled' })
    expect(stripe.sessions.get(stripe.sessionId())?.status).toBe('expired')
  })

  it('finds a session behind a cached 500 and closes it before cancelling', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    const { config } = await claimOnly(order)
    stripe.nextCreate = ['cached-500']
    expect((await stripe.createCheckoutSession(config)).kind).toBe('failed')
    expect(await cancel(deps(stripe), ids(order))).toEqual({ kind: 'cancelled' })
    expect(stripe.sessions.get(stripe.sessionId())?.status).toBe('expired')
  })

  it('cancels a claim that never made a session, once that is established', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await claimOnly(order)
    expect(await cancel(deps(stripe, { now: minutesLater(11) }), ids(order))).toEqual({ kind: 'cancelled' })
  })

  it('keeps the order when Stripe cannot be reached to check', async () => {
    const stripe = new FakeStripe()
    stripe.listFails = true
    const order = await createDraftOrder(db.pool)
    await claimOnly(order)
    expect(await cancel(deps(stripe, { now: minutesLater(11) }), ids(order)))
      .toEqual({ kind: 'try_again', message: CHECKOUT_MESSAGES.cancelLater })
    expect((await orderRow(order.registrationId)).status).toBe('draft')
  })

  it('ends Pay racing Cancel in one consistent state, with no payable session the order does not know about', async () => {
    for (let round = 0; round < 10; round++) {
      const stripe = new FakeStripe()
      const order = await createDraftOrder(db.pool)
      await Promise.all([pay(deps(stripe), ids(order)), cancel(deps(stripe), ids(order))])

      const row = await orderRow(order.registrationId)
      const open = stripe.sessionsFor(order.registrationId).filter((s) => s.status === 'open')
      expect(['cancelled', 'pending_payment']).toContain(row.status)
      if (row.status === 'cancelled') expect(open).toEqual([])
      else expect(open.map((s) => s.id)).toEqual([row.stripe_checkout_session_id])
    }
  })
})

describe('syncConfirmation', () => {
  it('confirms from the success page when Stripe says the checkout is complete', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await pay(deps(stripe), ids(order))
    stripe.pay(stripe.sessionId())
    expect((await syncConfirmation(deps(stripe), ids(order)))?.kind).toBe('paid')
  })

  it("never confirms from another order's session", async () => {
    const stripe = new FakeStripe()
    const theirs = await createDraftOrder(db.pool)
    await pay(deps(stripe), ids(theirs))
    stripe.pay(stripe.sessionId())

    const mine = await createDraftOrder(db.pool)
    await claimOnly(mine)
    expect(await syncConfirmation(deps(stripe), ids(mine))).toBeNull()
    const { rows } = await db.pool.query('SELECT count(*)::int AS n FROM payment_exceptions WHERE registration_id = $1', [mine.registrationId])
    expect(rows[0].n).toBe(0)
    expect((await orderRow(mine.registrationId)).status).toBe('draft')
  })

  it('tells the family to wait, not to pay again, when confirmation fails for now', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await pay(deps(stripe), ids(order))
    stripe.pay(stripe.sessionId())
    const broken = { ...deps(stripe), store: { ...store, confirmOrderPayment: async () => { throw new Error('database is down') } } }
    expect(await pay(broken, ids(order))).toEqual(CHECKING)
  })

  it('says it is checking when the checkout completed unpaid', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await pay(deps(stripe), ids(order))
    stripe.completeUnpaid(stripe.sessionId())
    expect(await syncConfirmation(deps(stripe), ids(order))).toEqual(CHECKING)
    expect((await orderRow(order.registrationId)).status).toBe('pending_payment')
  })

  it('logs every case it records, with its reference', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await pay(deps(stripe), ids(order))
    stripe.pay(stripe.sessionId())
    // Before the payment is confirmed, the hold passes and the family submits again
    await asService(db.pool, (c) =>
      c.query(
        `UPDATE registrations SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`,
        [order.registrationId]
      )
    )
    const newer = await store.createOrder(
      order.family.householdId,
      order.listing.listing.id,
      buildPayload({ listing: order.listing, dancers: order.dancers, entries: order.entries })
    )
    expect(newer.status).toBe('created')

    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const result = await syncConfirmation(deps(stripe), ids(order))
      const { rows } = await db.pool.query(
        'SELECT support_ref FROM payment_exceptions WHERE registration_id = $1',
        [order.registrationId]
      )
      expect(rows).toHaveLength(1)
      const ref = rows[0].support_ref
      expect(result).toEqual({ kind: 'review', message: reviewMessage('A', ref), supportRef: ref })
      expect(logged).toHaveBeenCalledWith(
        `[PAYMENT_EXCEPTION] ${ref} late_payment_conflict order ${order.registrationId}`
      )
    } finally {
      logged.mockRestore()
    }
  })
})

describe('payResultFromConfirmation', () => {
  it('says it is checking, not to pay again, when Stripe does not call it paid yet', () => {
    expect(payResultFromConfirmation({ result: 'not_paid' })).toEqual(CHECKING)
  })
})
