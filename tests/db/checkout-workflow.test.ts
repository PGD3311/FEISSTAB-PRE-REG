import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cancel, CHECKOUT_MESSAGES, pay, syncConfirmation, type CheckoutDeps } from '@/app/_payments/checkout-workflow'
import { createOrderStore, type OrderStore } from '@/app/_payments/order-store'
import { reviewMessage } from '@/lib/payment-review-messages'
import { createTestDatabase, type TestDatabase } from './helpers/db'
import { FakeStripe } from './helpers/fake-stripe'
import { checkoutConfigFor, createDraftOrder, type DraftOrderFixture } from './helpers/fixtures'
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

  it('starts no checkout once the organiser closes registration, and leaves the order alone', async () => {
    const stripe = new FakeStripe()
    const order = await createDraftOrder(db.pool)
    await db.pool.query(`UPDATE feis_listings SET status = 'closed' WHERE id = $1`, [order.listing.listing.id])
    expect(await pay(deps(stripe), ids(order)))
      .toEqual({ kind: 'blocked', message: 'Registration has been closed by the organiser.' })
    expect((await orderRow(order.registrationId)).checkout_claim_id).toBeNull()
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
    expect(await pay(broken, ids(order))).toEqual({ kind: 'try_again', message: reviewMessage('C', null) })
  })
})
