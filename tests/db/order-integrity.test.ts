import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { REGISTRATION_TRANSITIONS } from '@/lib/registration-states'
import type { RegistrationStatus } from '@/lib/types/feis-listing'
import { asParent, asRole, asService, createTestDatabase, refused, type TestDatabase } from './helpers/db'
import { createDancer, createFamily, createListing, insertOrderDirect } from './helpers/fixtures'

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
})

afterAll(async () => {
  await db.drop()
})

async function familyWithDraft() {
  const listing = await createListing(db.pool)
  const family = await createFamily(db.pool)
  const dancer = await createDancer(db.pool, family.householdId)
  const draftId = await insertOrderDirect(db.pool, family.householdId, listing.listing.id, [
    { dancerId: dancer.id, competitionId: listing.competitions[0].id },
  ])
  return { listing, family, dancer, draftId }
}

async function orderRow(id: string) {
  const { rows } = await db.pool.query('SELECT * FROM registrations WHERE id = $1', [id])
  return rows[0]
}

async function countRows(table: string, column: string, value: string): Promise<number> {
  const { rows } = await db.pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [value])
  return rows[0].n
}

describe('parent access to orders', () => {
  it('lets a parent read their own orders, entries and snapshots, and nothing of another family', async () => {
    const { family, dancer, draftId } = await familyWithDraft()
    const paidListing = await createListing(db.pool)
    const paidId = await insertOrderDirect(
      db.pool, family.householdId, paidListing.listing.id,
      [{ dancerId: dancer.id, competitionId: paidListing.competitions[0].id }],
      { status: 'paid' }
    )
    const other = await familyWithDraft()

    const seen = await asParent(db.pool, family.userId, async (c) => ({
      orders: (await c.query('SELECT id FROM registrations')).rows.map((r) => r.id),
      entries: (await c.query('SELECT registration_id FROM registration_entries')).rowCount,
      snapshots: (await c.query('SELECT registration_id FROM registration_snapshots')).rows.map((r) => r.registration_id),
    }))

    expect(seen.orders.sort()).toEqual([draftId, paidId].sort())
    expect(seen.orders).not.toContain(other.draftId)
    expect(seen.entries).toBe(2)
    expect(seen.snapshots).toEqual([paidId])
  })

  it('refuses every parent write and leaves the rows unchanged', async () => {
    const { family, dancer, listing, draftId } = await familyWithDraft()
    const before = await orderRow(draftId)
    const attempts = [
      `UPDATE registrations SET status = 'paid' WHERE id = '${draftId}'`,
      `UPDATE registrations SET total_cents = 1 WHERE id = '${draftId}'`,
      `UPDATE registrations SET status = 'cancelled' WHERE id = '${draftId}'`,
      `DELETE FROM registrations WHERE id = '${draftId}'`,
      `INSERT INTO registration_entries (registration_id, dancer_id, feis_competition_id, fee_category, base_fee_cents)
         VALUES ('${draftId}', '${dancer.id}', '${listing.competitions[1].id}', 'solo', 0)`,
      `UPDATE registration_entries SET base_fee_cents = 0 WHERE registration_id = '${draftId}'`,
      `DELETE FROM registration_entries WHERE registration_id = '${draftId}'`,
      `INSERT INTO registration_snapshots (registration_id, snapshot_data) VALUES ('${draftId}', '{}')`,
    ]
    for (const sql of attempts) {
      expect(await refused(asParent(db.pool, family.userId, (c) => c.query(sql)))).toMatch(/permission denied/)
    }
    expect(await orderRow(draftId)).toEqual(before)
    const { rows } = await db.pool.query(
      'SELECT count(*)::int AS n, sum(base_fee_cents)::int AS fees FROM registration_entries WHERE registration_id = $1',
      [draftId]
    )
    expect(rows[0]).toEqual({ n: 1, fees: 1500 })
    expect(await countRows('registration_snapshots', 'registration_id', draftId)).toBe(0)
  })

  it('gives anon no access to orders at all', async () => {
    const { draftId } = await familyWithDraft()
    const message = await refused(
      asRole(db.pool, 'anon', null, (c) => c.query('SELECT id FROM registrations WHERE id = $1', [draftId]))
    )
    expect(message).toMatch(/permission denied/)
  })

  it('has exactly the expected policies on the three order tables', async () => {
    const { rows } = await db.pool.query(`
      SELECT tablename, policyname, cmd, array_to_string(roles, ',') AS roles
      FROM pg_policies
      WHERE schemaname = 'pre_registration'
        AND tablename IN ('registrations', 'registration_entries', 'registration_snapshots')
      ORDER BY tablename, policyname`)
    expect(rows).toEqual([
      { tablename: 'registration_entries', policyname: 'Organisers read entries for their feiseanna', cmd: 'SELECT', roles: 'authenticated' },
      { tablename: 'registration_entries', policyname: 'Parents read own entries', cmd: 'SELECT', roles: 'authenticated' },
      { tablename: 'registration_snapshots', policyname: 'Organisers read snapshots for their feiseanna', cmd: 'SELECT', roles: 'authenticated' },
      { tablename: 'registration_snapshots', policyname: 'Parents read own snapshots', cmd: 'SELECT', roles: 'authenticated' },
      { tablename: 'registrations', policyname: 'Organisers read registrations for their feiseanna', cmd: 'SELECT', roles: 'authenticated' },
      { tablename: 'registrations', policyname: 'Parents read own registrations', cmd: 'SELECT', roles: 'authenticated' },
    ])
  })

  it('leaves anon and authenticated with no write privileges on the order tables', async () => {
    const { rows } = await db.pool.query(`
      SELECT r.role, t.tbl, p.priv
      FROM unnest(ARRAY['anon', 'authenticated']) AS r(role)
      CROSS JOIN unnest(ARRAY['registrations', 'registration_entries', 'registration_snapshots']) AS t(tbl)
      CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p(priv)
      WHERE has_table_privilege(r.role, 'pre_registration.' || t.tbl, p.priv)`)
    expect(rows).toEqual([])
  })
})

describe('what never changes, for any role', () => {
  it('refuses entries added outside order creation, even by the service role', async () => {
    const { dancer, listing, draftId } = await familyWithDraft()
    const message = await refused(asService(db.pool, (c) => c.query(
      `INSERT INTO registration_entries (registration_id, dancer_id, feis_competition_id, fee_category, base_fee_cents)
       VALUES ($1, $2, $3, 'solo', 1500)`,
      [draftId, dancer.id, listing.competitions[1].id]
    )))
    expect(message).toMatch(/entries are fixed/)
    expect(await countRows('registration_entries', 'registration_id', draftId)).toBe(1)
  })

  it('refuses changes to and deletes of entries, even by the service role', async () => {
    const { draftId } = await familyWithDraft()
    expect(await refused(asService(db.pool, (c) => c.query(
      `UPDATE registration_entries SET base_fee_cents = 0 WHERE registration_id = $1`, [draftId])))).toMatch(/entries are fixed/)
    expect(await refused(asService(db.pool, (c) => c.query(
      `DELETE FROM registration_entries WHERE registration_id = $1`, [draftId])))).toMatch(/entries are fixed/)
    const { rows } = await db.pool.query(
      'SELECT count(*)::int AS n, sum(base_fee_cents)::int AS fees FROM registration_entries WHERE registration_id = $1',
      [draftId]
    )
    expect(rows[0]).toEqual({ n: 1, fees: 1500 })
  })

  it('refuses orders created outside create_order', async () => {
    const { family } = await familyWithDraft()
    const other = await createListing(db.pool)
    const message = await refused(asService(db.pool, (c) => c.query(
      `INSERT INTO registrations (feis_listing_id, household_id, purchase_snapshot) VALUES ($1, $2, '{}')`,
      [other.listing.id, family.householdId]
    )))
    expect(message).toMatch(/only be created by create_order/)
    expect(await countRows('registrations', 'feis_listing_id', other.listing.id)).toBe(0)
  })

  it('starts every order as an unpaid draft with no payment or checkout details', async () => {
    const { family } = await familyWithDraft()
    const other = await createListing(db.pool)
    const presets: Record<string, string> = {
      status: `'paid'`,
      paid_at: 'now()',
      confirmation_number: `'RF-X'`,
      stripe_payment_intent_id: `'pi_x'`,
      stripe_checkout_session_id: `'cs_x'`,
      checkout_claim_id: 'gen_random_uuid()',
      checkout_config: `'{}'`,
      checkout_claimed_at: 'now()',
    }
    for (const [column, value] of Object.entries(presets)) {
      const id = randomUUID()
      const message = await refused(asService(db.pool, async (c) => {
        await c.query(`SELECT set_config('pre_registration.creating_order', $1, true)`, [id])
        return c.query(
          `INSERT INTO registrations (id, feis_listing_id, household_id, purchase_snapshot, ${column})
           VALUES ($1, $2, $3, '{}', ${value})`,
          [id, other.listing.id, family.householdId]
        )
      }))
      expect(message, column).toMatch(/starts as an unpaid draft/)
    }
    expect(await countRows('registrations', 'feis_listing_id', other.listing.id)).toBe(0)
  })

  it("refuses changes to an order's contents", async () => {
    const { draftId } = await familyWithDraft()
    const before = await orderRow(draftId)
    for (const sql of [
      `UPDATE registrations SET total_cents = 1 WHERE id = $1`,
      `UPDATE registrations SET purchase_snapshot = '{"version": 2}' WHERE id = $1`,
      `UPDATE registrations SET consent_ip = '1.1.1.1' WHERE id = $1`,
    ]) {
      expect(await refused(asService(db.pool, (c) => c.query(sql, [draftId])))).toMatch(/contents never change/)
    }
    expect(await orderRow(draftId)).toEqual(before)
  })

  it('never deletes an order', async () => {
    const { draftId } = await familyWithDraft()
    expect(await refused(asService(db.pool, (c) => c.query('DELETE FROM registrations WHERE id = $1', [draftId]))))
      .toMatch(/never deleted/)
    expect(await orderRow(draftId)).toMatchObject({ id: draftId, status: 'draft' })
  })

  it('sets a checkout claim once', async () => {
    const { draftId } = await familyWithDraft()
    await asService(db.pool, (c) => c.query(
      `UPDATE registrations SET checkout_claim_id = gen_random_uuid(), checkout_config = '{}', checkout_expires_at = now() + interval '1 hour'
       WHERE id = $1`, [draftId]))
    const claimed = await orderRow(draftId)
    expect(claimed.checkout_claim_id).not.toBeNull()
    expect(await refused(asService(db.pool, (c) => c.query(
      `UPDATE registrations SET checkout_claim_id = gen_random_uuid() WHERE id = $1`, [draftId]))))
      .toMatch(/claim is set once/)
    expect(await orderRow(draftId)).toEqual(claimed)
  })

  it("attaches a checkout session once and never changes a paid order's payment record", async () => {
    const { family, dancer, draftId } = await familyWithDraft()
    await asService(db.pool, (c) => c.query(
      `UPDATE registrations SET stripe_checkout_session_id = 'cs_first' WHERE id = $1`, [draftId]))
    expect(await refused(asService(db.pool, (c) => c.query(
      `UPDATE registrations SET stripe_checkout_session_id = 'cs_second' WHERE id = $1`, [draftId]))))
      .toMatch(/session is attached once/)
    expect((await orderRow(draftId)).stripe_checkout_session_id).toBe('cs_first')

    const paidListing = await createListing(db.pool)
    const paidId = await insertOrderDirect(db.pool, family.householdId, paidListing.listing.id,
      [{ dancerId: dancer.id, competitionId: paidListing.competitions[0].id }], { status: 'paid' })
    const paid = await orderRow(paidId)
    for (const sql of [
      `UPDATE registrations SET confirmation_number = 'RF-CHANGED' WHERE id = $1`,
      `UPDATE registrations SET stripe_payment_intent_id = 'pi_changed' WHERE id = $1`,
      `UPDATE registrations SET paid_at = now() - interval '1 day' WHERE id = $1`,
    ]) {
      expect(await refused(asService(db.pool, (c) => c.query(sql, [paidId])))).toMatch(/payment record never changes/)
    }
    expect(await orderRow(paidId)).toEqual(paid)
  })

  it('refuses status moves outside the table', async () => {
    const { family, dancer } = await familyWithDraft()
    const paidListing = await createListing(db.pool)
    const paidId = await insertOrderDirect(db.pool, family.householdId, paidListing.listing.id,
      [{ dancerId: dancer.id, competitionId: paidListing.competitions[0].id }], { status: 'paid' })
    expect(await refused(asService(db.pool, (c) => c.query(
      `UPDATE registrations SET status = 'draft' WHERE id = $1`, [paidId])))).toMatch(/cannot move from paid to draft/)
    expect((await orderRow(paidId)).status).toBe('paid')

    const cancelled = await familyWithDraft()
    await asService(db.pool, (c) => c.query(`UPDATE registrations SET status = 'cancelled' WHERE id = $1`, [cancelled.draftId]))
    expect(await refused(asService(db.pool, (c) => c.query(
      `UPDATE registrations SET status = 'paid' WHERE id = $1`, [cancelled.draftId])))).toMatch(/cannot move from cancelled to paid/)
    expect((await orderRow(cancelled.draftId)).status).toBe('cancelled')
  })

  it('keeps snapshots permanent', async () => {
    const { family, dancer } = await familyWithDraft()
    const paidListing = await createListing(db.pool)
    const paidId = await insertOrderDirect(db.pool, family.householdId, paidListing.listing.id,
      [{ dancerId: dancer.id, competitionId: paidListing.competitions[0].id }], { status: 'paid' })
    expect(await refused(asService(db.pool, (c) => c.query(
      `UPDATE registration_snapshots SET snapshot_data = '{}' WHERE registration_id = $1`, [paidId])))).toMatch(/written once/)
    expect(await refused(asService(db.pool, (c) => c.query(
      `DELETE FROM registration_snapshots WHERE registration_id = $1`, [paidId])))).toMatch(/written once/)
    const { rows } = await db.pool.query(
      'SELECT snapshot_data FROM registration_snapshots WHERE registration_id = $1',
      [paidId]
    )
    expect(rows).toEqual([{ snapshot_data: { test: true } }])
  })

  it('writes a snapshot only for the order being fulfilled', async () => {
    const { draftId } = await familyWithDraft()
    expect(await refused(asService(db.pool, (c) => c.query(
      `INSERT INTO registration_snapshots (registration_id, snapshot_data) VALUES ($1, '{}')`, [draftId])))).toMatch(/written once/)
    expect(await refused(asService(db.pool, async (c) => {
      await c.query(`SELECT set_config('pre_registration.fulfilling_order', $1, true)`, [randomUUID()])
      return c.query(`INSERT INTO registration_snapshots (registration_id, snapshot_data) VALUES ($1, '{}')`, [draftId])
    }))).toMatch(/written once/)
    expect(await countRows('registration_snapshots', 'registration_id', draftId)).toBe(0)
  })

  it('requires a purchase snapshot on every unpaid order', async () => {
    const { family } = await familyWithDraft()
    const other = await createListing(db.pool)
    const client = await db.pool.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query('SELECT gen_random_uuid() AS id')
      await client.query(`SELECT set_config('pre_registration.creating_order', $1, true)`, [rows[0].id])
      const message = await refused(client.query(
        `INSERT INTO registrations (id, feis_listing_id, household_id) VALUES ($1, $2, $3)`,
        [rows[0].id, other.listing.id, family.householdId]
      ))
      expect(message).toMatch(/registrations_unpaid_needs_purchase_snapshot/)
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
    expect(await countRows('registrations', 'feis_listing_id', other.listing.id)).toBe(0)
  })

  it('agrees with the TypeScript transition table', async () => {
    const statuses = Object.keys(REGISTRATION_TRANSITIONS) as RegistrationStatus[]
    for (const from of statuses) {
      for (const to of statuses) {
        const { rows } = await db.pool.query('SELECT registration_transition_allowed($1, $2) AS ok', [from, to])
        expect({ from, to, ok: rows[0].ok }).toEqual({ from, to, ok: REGISTRATION_TRANSITIONS[from].includes(to) })
      }
    }
  })

  it('schedules the hold-expiry job with schema-qualified names', async () => {
    const { rows } = await db.pool.query(`SELECT command FROM cron.job WHERE jobname = 'expire-registration-holds'`)
    expect(rows[0].command).toContain('pre_registration.registrations')
  })
})
