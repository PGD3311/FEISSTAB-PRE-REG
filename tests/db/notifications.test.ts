import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createNotificationStore, type NotificationStore } from '@/app/_payments/notification-store'
import { processNotifications, type WorkerDeps } from '@/app/_payments/notification-worker'
import { createOrderStore } from '@/app/_payments/order-store'
import { createTestDatabase, type TestDatabase } from './helpers/db'
import { FakeEmail } from './helpers/fake-email'
import { createDraftOrder, readyToPay, type DraftOrderFixture } from './helpers/fixtures'
import { pgRpc } from './helpers/pg-rpc'

let db: TestDatabase
let notifications: NotificationStore
let clock: Date

beforeEach(async () => {
  db = await createTestDatabase()
  notifications = createNotificationStore(pgRpc(db.pool))
  clock = new Date()
})

afterEach(async () => {
  await db?.drop()
})

const CONTACTS = ['daniel@runfeis.test', 'steve@runfeis.test']

function worker(email: FakeEmail, overrides: Partial<WorkerDeps> = {}): WorkerDeps {
  return {
    store: notifications,
    sender: email,
    config: { from: 'RunFeis <hello@runfeis.test>', alertRecipients: CONTACTS, baseUrl: 'https://runfeis.test' },
    now: () => clock,
    log: () => undefined,
    ...overrides
  }
}

function advance(minutes: number) {
  clock = new Date(clock.getTime() + minutes * 60_000)
}

async function confirmedOrder(opts: { amountCents?: number } = {}): Promise<DraftOrderFixture> {
  const order = await createDraftOrder(db.pool)
  const ready = await readyToPay(db.pool, order)
  await createOrderStore(pgRpc(db.pool)).confirmOrderPayment({
    registrationId: order.registrationId, claimId: ready.claimId, sessionId: ready.sessionId, account: ready.config.account,
    amountCents: opts.amountCents ?? order.payload.total_cents, currency: 'usd', paymentStatus: 'paid',
    paymentIntentId: `pi_${ready.sessionId}`, chargeId: null, eventId: 'evt_test', source: 'webhook'
  })
  // The queued rows are due "now" by the database clock; start the test clock just after that
  clock = new Date(Date.now() + 1_000)
  return order
}

async function row(kind: string) {
  const { rows } = await db.pool.query('SELECT * FROM notifications WHERE kind = $1 ORDER BY created_at LIMIT 1', [kind])
  return rows[0]
}

describe('the notification queue', () => {
  it('sends a queued confirmation once and saves the provider id', async () => {
    const order = await confirmedOrder()
    const email = new FakeEmail()
    expect(await processNotifications(worker(email))).toEqual({ paused: false, claimed: 1, sent: 1 })
    await processNotifications(worker(email))

    expect(email.delivered).toHaveLength(1)
    expect(email.delivered[0].key).toBe(`confirmation:${order.registrationId}:0`)
    expect(email.delivered[0].email.to).toEqual([order.family.email])
    expect(email.delivered[0].email.subject).toBe("You're entered: Test Feis")
    // main's email: the dancer's competitor number (the feis numbers from 101) and competition codes
    expect(email.delivered[0].email.html).toContain('>101<')
    expect(email.delivered[0].email.html).toContain('>210R<')
    expect(email.delivered[0].email.html).toContain('>210SJ<')
    expect(await row('registration_confirmation')).toMatchObject({ status: 'sent', provider_message_id: 'em_1', attempts: 1 })
  })

  it('freezes the recipient and message before the first send', async () => {
    const order = await confirmedOrder()
    const email = new FakeEmail()
    email.next = ['reject']
    await processNotifications(worker(email))
    await db.pool.query(`UPDATE feis_listings SET name = 'Renamed Feis' WHERE id = $1`, [order.listing.listing.id])
    advance(6)
    await processNotifications(worker(email))

    expect(email.delivered).toHaveLength(1)
    expect(email.delivered[0].email.subject).toBe("You're entered: Test Feis")
    expect(email.delivered[0].key).toBe(`confirmation:${order.registrationId}:1`)
  })

  it('gives up after six refusals and alerts the payments contacts', async () => {
    await confirmedOrder()
    const email = new FakeEmail()
    email.next = ['reject', 'reject', 'reject', 'reject', 'reject', 'reject']
    for (let attempt = 0; attempt < 6; attempt++) {
      await processNotifications(worker(email))
      advance(13 * 60)
    }
    expect(await row('registration_confirmation')).toMatchObject({ status: 'failed', attempts: 6 })
    await processNotifications(worker(email))
    expect(email.delivered.map((d) => d.email.to)).toEqual([CONTACTS])
    expect(email.delivered[0].email.subject).toMatch(/^\[RunFeis\] Email not delivered: confirmation:/)
  })

  it('retries an uncertain send with the same key, so it is delivered once', async () => {
    await confirmedOrder()
    const email = new FakeEmail()
    email.next = ['uncertain-after']
    await processNotifications(worker(email))
    expect(await row('registration_confirmation')).toMatchObject({ status: 'pending', last_outcome: 'uncertain', send_generation: 0 })
    advance(6)
    await processNotifications(worker(email))
    expect(email.delivered).toHaveLength(1)
    expect(await row('registration_confirmation')).toMatchObject({ status: 'sent' })
  })

  it('recovers a send whose worker stopped after the provider accepted it', async () => {
    await confirmedOrder()
    const email = new FakeEmail()
    const [claimed] = await notifications.claim(10, clock)
    const frozen = await notifications.freeze(claimed.id, claimed.claim_token, claimed.recipient!, { from: 'x', subject: 's', html: 'h' })
    await email.send({ from: frozen!.payload.from, to: [frozen!.recipient], subject: 's', html: 'h' }, `${claimed.dedupe_key}:0`)
    // The worker stopped here, before complete_notification
    advance(11)
    await processNotifications(worker(email))
    expect(email.delivered).toHaveLength(1)
    expect(await row('registration_confirmation')).toMatchObject({ status: 'sent' })
  })

  it('holds an uncertain delivery for a person after 23 hours, and never sends it again', async () => {
    await confirmedOrder()
    const email = new FakeEmail()
    email.next = ['uncertain-before']
    await processNotifications(worker(email))
    advance(23 * 60 + 1)
    await processNotifications(worker(email))
    expect(await row('registration_confirmation')).toMatchObject({ status: 'needs_check' })
    expect(email.delivered.filter((d) => d.key.startsWith('confirmation:'))).toEqual([])
    expect(await row('delivery_failure_alert')).toBeDefined()
  })

  it('lets only the newest claim finish', async () => {
    await confirmedOrder()
    const [first] = await notifications.claim(10, clock)
    advance(11)
    const [second] = await notifications.claim(10, clock)
    expect(second.id).toBe(first.id)
    expect(await notifications.complete({ id: first.id, claimToken: first.claim_token, outcome: 'sent', providerMessageId: 'em_old', error: null, now: clock }))
      .toBe('stale_claim')
    expect(await notifications.complete({ id: second.id, claimToken: second.claim_token, outcome: 'sent', providerMessageId: 'em_new', error: null, now: clock }))
      .toBe('sent')
    expect(await row('registration_confirmation')).toMatchObject({ status: 'sent', provider_message_id: 'em_new' })
  })

  it('pauses without using attempts while email is not set up', async () => {
    await confirmedOrder()
    expect(await processNotifications(worker(new FakeEmail(), { config: null, sender: null })))
      .toEqual({ paused: true, claimed: 0, sent: 0 })
    expect(await row('registration_confirmation')).toMatchObject({ status: 'pending', attempts: 0 })
  })

  it('sends payment alerts to every payments contact', async () => {
    await confirmedOrder({ amountCents: 1 })
    const email = new FakeEmail()
    await processNotifications(worker(email))
    const alert = email.delivered.find((d) => d.key.startsWith('exception:'))
    expect(alert?.email.to).toEqual(CONTACTS)
    expect(alert?.email.subject).toMatch(/^\[RunFeis\] Payment case PAY-[A-Z2-9]{5}: amount_mismatch$/)
  })

  it('never raises an alert about an alert', async () => {
    await confirmedOrder({ amountCents: 1 })
    const email = new FakeEmail()
    email.next = Array(6).fill('reject')
    for (let attempt = 0; attempt < 6; attempt++) {
      await processNotifications(worker(email))
      advance(13 * 60)
    }
    expect(await row('payment_exception_alert')).toMatchObject({ status: 'failed' })
    const { rows } = await db.pool.query(`SELECT count(*)::int AS n FROM notifications WHERE kind = 'delivery_failure_alert'`)
    expect(rows[0].n).toBe(0)
  })

  it('never raises an alert about an alert that may not have been delivered', async () => {
    await confirmedOrder({ amountCents: 1 })
    const email = new FakeEmail()
    email.next = ['uncertain-before']
    await processNotifications(worker(email))
    advance(23 * 60 + 1)
    await processNotifications(worker(email))
    expect(await row('payment_exception_alert')).toMatchObject({ status: 'needs_check' })
    const { rows } = await db.pool.query(`SELECT count(*)::int AS n FROM notifications WHERE kind = 'delivery_failure_alert'`)
    expect(rows[0].n).toBe(0)
  })
})
