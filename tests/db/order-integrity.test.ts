import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { REGISTRATION_COLUMNS } from '@/lib/registration-columns'
import { REGISTRATION_TRANSITIONS } from '@/lib/registration-states'
import type { RegistrationStatus } from '@/lib/types/feis-listing'
import { asParent, asRole, asService, createTestDatabase, refused, type TestDatabase } from './helpers/db'
import { createDancer, createFamily, createListing, insertOrderDirect } from './helpers/fixtures'

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
})

afterAll(async () => {
  await db?.drop()
})

// The planned writers' updates (plan Tasks 8 and 9), so these tests hold the guards to what they will send
/** claim_checkout: all four claim columns at once, and the hold moved to 15 minutes after the checkout's expiry */
const CLAIM_SQL = `UPDATE registrations SET checkout_claim_id = gen_random_uuid(), checkout_config = '{}',
    checkout_claimed_at = now(), checkout_expires_at = now() + interval '60 minutes',
    hold_expires_at = now() + interval '75 minutes'
  WHERE id = $1`
/** attach_checkout_session: the claimed draft gets its session and awaits payment */
const ATTACH_SQL = `UPDATE registrations SET status = 'pending_payment', stripe_checkout_session_id = $2 WHERE id = $1`
/** _fulfil_order: every payment field with the status, attaching the session if Pay never did */
const FULFIL_SQL = `UPDATE registrations SET status = 'paid',
    stripe_checkout_session_id = coalesce(stripe_checkout_session_id, $2),
    stripe_payment_intent_id = 'pi_' || replace($1::text, '-', ''), stripe_charge_id = 'ch_' || replace($1::text, '-', ''),
    confirmation_number = 'RF-TEST-' || substr($1::text, 1, 8), paid_at = now(), hold_expires_at = NULL
  WHERE id = $1`

/** _fulfil_order's own order of steps: it names the order in the paid marker, then makes its one paid update */
async function fulfil(c: PoolClient, id: string, sessionId: string | null): Promise<void> {
  await c.query(`SELECT set_config('pre_registration.fulfilling_order', $1, true)`, [id])
  await c.query(FULFIL_SQL, [id, sessionId])
}

function newSessionId(): string {
  return `cs_${randomUUID().replace(/-/g, '')}`
}

async function claimDraft(id: string): Promise<void> {
  await asService(db.pool, (c) => c.query(CLAIM_SQL, [id]))
}

/** A claimed draft with its session attached, as Pay leaves it */
async function awaitingPayment(id: string): Promise<string> {
  const sessionId = newSessionId()
  await claimDraft(id)
  await asService(db.pool, (c) => c.query(ATTACH_SQL, [id, sessionId]))
  return sessionId
}

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

/** The columns the app's code may select on registrations: REGISTRATION_COLUMNS as a list */
const READABLE_COLUMNS = REGISTRATION_COLUMNS.split(',').map((column) => column.trim())
/** The columns that stay private to the database */
const PRIVATE_COLUMNS = ['consent_ip', 'checkout_config']

/** Every column of registrations that a role ($1) may SELECT, through a table-level or a column-level grant */
const SELECTABLE_COLUMNS_SQL = `
  SELECT attname::text AS name FROM pg_attribute
  WHERE attrelid = 'pre_registration.registrations'::regclass AND attnum > 0 AND NOT attisdropped
    AND has_column_privilege($1, attrelid, attnum, 'SELECT')
  ORDER BY attname`

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

  it('grants authenticated table-level SELECT on entries and snapshots only, and anon and PUBLIC nothing', async () => {
    // Reads the ACLs themselves, so a privilege a newer Postgres adds (PG17 MAINTAIN) shows up too.
    // registrations has no table-level grant: authenticated reads it through the column grants below.
    const { rows } = await db.pool.query(`
      SELECT c.relname AS tbl,
             CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
             a.privilege_type AS priv
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(c.relacl) AS a
      WHERE c.relnamespace = 'pre_registration'::regnamespace
        AND c.relname IN ('registrations', 'registration_entries', 'registration_snapshots')
        AND (a.grantee = 0 OR a.grantee IN ('anon'::regrole, 'authenticated'::regrole))
      ORDER BY c.relname, grantee, priv`)
    expect(rows).toEqual([
      { tbl: 'registration_entries', grantee: 'authenticated', priv: 'SELECT' },
      { tbl: 'registration_snapshots', grantee: 'authenticated', priv: 'SELECT' },
    ])

    // The column-level ACLs: only authenticated, only SELECT, only on registrations
    const { rows: columnGrants } = await db.pool.query(`
      SELECT DISTINCT c.relname AS tbl,
             CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
             a.privilege_type AS priv
      FROM pg_class c
      JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum > 0 AND NOT att.attisdropped
      CROSS JOIN LATERAL aclexplode(att.attacl) AS a
      WHERE c.relnamespace = 'pre_registration'::regnamespace
        AND c.relname IN ('registrations', 'registration_entries', 'registration_snapshots')
        AND (a.grantee = 0 OR a.grantee IN ('anon'::regrole, 'authenticated'::regrole))
      ORDER BY c.relname, grantee, priv`)
    expect(columnGrants).toEqual([{ tbl: 'registrations', grantee: 'authenticated', priv: 'SELECT' }])
  })

  it('gives authenticated table-level SELECT on entries and snapshots but not on registrations, and anon none', async () => {
    const { rows } = await db.pool.query(`
      SELECT r.role, t.tbl
      FROM unnest(ARRAY['anon', 'authenticated']) AS r(role)
      CROSS JOIN unnest(ARRAY['registrations', 'registration_entries', 'registration_snapshots']) AS t(tbl)
      WHERE has_table_privilege(r.role, 'pre_registration.' || t.tbl, 'SELECT')
      ORDER BY r.role, t.tbl`)
    expect(rows).toEqual([
      { role: 'authenticated', tbl: 'registration_entries' },
      { role: 'authenticated', tbl: 'registration_snapshots' },
    ])
  })

  it('leaves anon and authenticated no INSERT or UPDATE on any column, SELECT on columns only for authenticated, and keeps RLS on', async () => {
    // has_table_privilege misses column-level grants; has_any_column_privilege sees them
    const { rows } = await db.pool.query(`
      SELECT r.role, t.tbl, p.priv
      FROM unnest(ARRAY['anon', 'authenticated']) AS r(role)
      CROSS JOIN unnest(ARRAY['registrations', 'registration_entries', 'registration_snapshots']) AS t(tbl)
      CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE']) AS p(priv)
      WHERE has_any_column_privilege(r.role, 'pre_registration.' || t.tbl, p.priv)`)
    expect(rows).toEqual([])

    // SELECT is held through the column grants on registrations, so it shows here though it doesn't at table level
    const { rows: reads } = await db.pool.query(`
      SELECT r.role, t.tbl
      FROM unnest(ARRAY['anon', 'authenticated']) AS r(role)
      CROSS JOIN unnest(ARRAY['registrations', 'registration_entries', 'registration_snapshots']) AS t(tbl)
      WHERE has_any_column_privilege(r.role, 'pre_registration.' || t.tbl, 'SELECT')
      ORDER BY r.role, t.tbl`)
    expect(reads).toEqual([
      { role: 'authenticated', tbl: 'registration_entries' },
      { role: 'authenticated', tbl: 'registration_snapshots' },
      { role: 'authenticated', tbl: 'registrations' },
    ])

    const { rows: rls } = await db.pool.query(`
      SELECT relname AS tbl, relrowsecurity AS rls FROM pg_class
      WHERE relnamespace = 'pre_registration'::regnamespace
        AND relname IN ('registrations', 'registration_entries', 'registration_snapshots')
      ORDER BY relname`)
    expect(rls).toEqual([
      { tbl: 'registration_entries', rls: true },
      { tbl: 'registration_snapshots', rls: true },
      { tbl: 'registrations', rls: true },
    ])
  })
})

describe('organiser access to orders', () => {
  it('lets the organiser of a feis read its orders, entries and snapshots, and no other organiser', async () => {
    const { listing, draftId } = await familyWithDraft()
    const otherFamily = await createFamily(db.pool)
    const otherDancer = await createDancer(db.pool, otherFamily.householdId)
    const paidId = await insertOrderDirect(
      db.pool, otherFamily.householdId, listing.listing.id,
      [{ dancerId: otherDancer.id, competitionId: listing.competitions[1].id }],
      { status: 'paid' }
    )
    const elsewhere = await createListing(db.pool)

    const readAs = (userId: string) => asRole(db.pool, 'authenticated', userId, async (c) => ({
      orders: (await c.query('SELECT id FROM registrations')).rows.map((r) => r.id).sort(),
      entries: (await c.query('SELECT registration_id FROM registration_entries')).rowCount,
      snapshots: (await c.query('SELECT registration_id FROM registration_snapshots')).rows.map((r) => r.registration_id),
    }))

    expect(await readAs(listing.organiserId)).toEqual({ orders: [draftId, paidId].sort(), entries: 2, snapshots: [paidId] })
    expect(await readAs(elsewhere.organiserId)).toEqual({ orders: [], entries: 0, snapshots: [] })
  })
})

describe('private order columns', () => {
  it('lets authenticated select exactly the columns in REGISTRATION_COLUMNS, and anon none', async () => {
    const { rows: all } = await db.pool.query(
      `SELECT attname::text AS name FROM pg_attribute
       WHERE attrelid = 'pre_registration.registrations'::regclass AND attnum > 0 AND NOT attisdropped`
    )
    const tableColumns: string[] = all.map((r) => r.name)
    const selectable: string[] = (await db.pool.query(SELECTABLE_COLUMNS_SQL, ['authenticated'])).rows.map((r) => r.name)

    expect(new Set(READABLE_COLUMNS).size).toBe(READABLE_COLUMNS.length)
    expect(selectable).toEqual([...READABLE_COLUMNS].sort())
    // A column a later migration adds is private until it is granted and added to REGISTRATION_COLUMNS: this fails until then
    expect(tableColumns.filter((name) => !selectable.includes(name)).sort()).toEqual([...PRIVATE_COLUMNS].sort())
    expect((await db.pool.query(SELECTABLE_COLUMNS_SQL, ['anon'])).rows).toEqual([])
  })

  it('refuses a parent consent_ip, checkout_config and SELECT * on their own order', async () => {
    const { family, draftId } = await familyWithDraft()
    await claimDraft(draftId)
    for (const column of PRIVATE_COLUMNS) {
      expect(
        await refused(asParent(db.pool, family.userId, (c) =>
          c.query(`SELECT ${column} FROM registrations WHERE id = $1`, [draftId])
        )),
        column
      ).toMatch(/permission denied/)
    }
    expect(await refused(asParent(db.pool, family.userId, (c) =>
      c.query('SELECT * FROM registrations WHERE id = $1', [draftId])
    ))).toMatch(/permission denied/)
    expect(await refused(asParent(db.pool, family.userId, (c) =>
      c.query(`SELECT ${REGISTRATION_COLUMNS}, consent_ip FROM registrations WHERE id = $1`, [draftId])
    ))).toMatch(/permission denied/)
  })

  it('refuses an organiser consent_ip, checkout_config and SELECT * on their feis\'s order', async () => {
    const { listing, draftId } = await familyWithDraft()
    await claimDraft(draftId)
    for (const column of PRIVATE_COLUMNS) {
      expect(
        await refused(asRole(db.pool, 'authenticated', listing.organiserId, (c) =>
          c.query(`SELECT ${column} FROM registrations WHERE id = $1`, [draftId])
        )),
        column
      ).toMatch(/permission denied/)
    }
    expect(await refused(asRole(db.pool, 'authenticated', listing.organiserId, (c) =>
      c.query('SELECT * FROM registrations WHERE id = $1', [draftId])
    ))).toMatch(/permission denied/)
  })

  it('refuses the private columns in a filter or a sort too, not just in the select list', async () => {
    const { family } = await familyWithDraft()
    for (const column of PRIVATE_COLUMNS) {
      for (const clause of [`WHERE ${column} IS NOT NULL`, `ORDER BY ${column}`]) {
        expect(
          await refused(asParent(db.pool, family.userId, (c) =>
            c.query(`SELECT id FROM registrations ${clause}`)
          )),
          `${column}: ${clause}`
        ).toMatch(/permission denied/)
      }
    }
  })

  it('lets a parent read their own order with REGISTRATION_COLUMNS', async () => {
    const { family, draftId } = await familyWithDraft()
    await claimDraft(draftId)
    const rows = await asParent(db.pool, family.userId, async (c) =>
      (await c.query(`SELECT ${REGISTRATION_COLUMNS} FROM registrations WHERE id = $1`, [draftId])).rows
    )
    expect(rows).toHaveLength(1)
    expect(Object.keys(rows[0]).sort()).toEqual([...READABLE_COLUMNS].sort())
    expect(rows[0]).toMatchObject({ id: draftId, household_id: family.householdId, status: 'draft' })
    expect(rows[0].checkout_claim_id).not.toBeNull()
  })

  it("lets an organiser read their feis's order with REGISTRATION_COLUMNS", async () => {
    const { listing, family, draftId } = await familyWithDraft()
    const rows = await asRole(db.pool, 'authenticated', listing.organiserId, async (c) =>
      (await c.query(`SELECT ${REGISTRATION_COLUMNS} FROM registrations WHERE id = $1`, [draftId])).rows
    )
    expect(rows).toHaveLength(1)
    expect(Object.keys(rows[0]).sort()).toEqual([...READABLE_COLUMNS].sort())
    expect(rows[0]).toMatchObject({ id: draftId, household_id: family.householdId, feis_listing_id: listing.listing.id })
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

  it('adds entries only to an order created in the same transaction', async () => {
    const { dancer, listing, draftId } = await familyWithDraft()
    // The marker names an order that was created in an earlier transaction
    const message = await refused(asService(db.pool, async (c) => {
      await c.query(`SELECT set_config('pre_registration.creating_order', $1, true)`, [draftId])
      return c.query(
        `INSERT INTO registration_entries (registration_id, dancer_id, feis_competition_id, fee_category, base_fee_cents)
         VALUES ($1, $2, $3, 'solo', 1500)`,
        [draftId, dancer.id, listing.competitions[1].id]
      )
    }))
    expect(message).toMatch(/entries are fixed/)
    expect(await countRows('registration_entries', 'registration_id', draftId)).toBe(1)
  })

  it('adds entries only while the marker names the order', async () => {
    const { family, dancer } = await familyWithDraft()
    const other = await createListing(db.pool)
    const id = randomUUID()
    // The order is created in this transaction, but the marker names a different order
    const message = await refused(asService(db.pool, async (c) => {
      await c.query(`SELECT set_config('pre_registration.creating_order', $1, true)`, [id])
      await c.query(
        `INSERT INTO registrations (id, feis_listing_id, household_id, purchase_snapshot, hold_expires_at)
         VALUES ($1, $2, $3, '{}', now() + interval '30 minutes')`,
        [id, other.listing.id, family.householdId]
      )
      await c.query(`SELECT set_config('pre_registration.creating_order', $1, true)`, [randomUUID()])
      return c.query(
        `INSERT INTO registration_entries (registration_id, dancer_id, feis_competition_id, fee_category, base_fee_cents)
         VALUES ($1, $2, $3, 'solo', 1500)`,
        [id, dancer.id, other.competitions[0].id]
      )
    }))
    expect(message).toMatch(/entries are fixed/)
    expect(await countRows('registrations', 'feis_listing_id', other.listing.id)).toBe(0)
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
      stripe_charge_id: `'ch_x'`,
      stripe_checkout_session_id: `'cs_x'`,
      checkout_claim_id: 'gen_random_uuid()',
      checkout_config: `'{}'`,
      checkout_claimed_at: 'now()',
      checkout_expires_at: `now() + interval '1 hour'`,
    }
    for (const [column, value] of Object.entries(presets)) {
      const id = randomUUID()
      const message = await refused(asService(db.pool, async (c) => {
        await c.query(`SELECT set_config('pre_registration.creating_order', $1, true)`, [id])
        return c.query(
          `INSERT INTO registrations (id, feis_listing_id, household_id, purchase_snapshot, hold_expires_at, ${column})
           VALUES ($1, $2, $3, '{}', now() + interval '30 minutes', ${value})`,
          [id, other.listing.id, family.householdId]
        )
      }))
      expect(message, column).toMatch(/starts as an unpaid draft/)
    }
    expect(await countRows('registrations', 'feis_listing_id', other.listing.id)).toBe(0)
  })

  it("refuses changes to an order's contents", async () => {
    const { draftId } = await familyWithDraft()
    // Valid values that belong to someone else, so only the guard can be what refuses them
    const other = await familyWithDraft()
    const before = await orderRow(draftId)
    // One update per column the guard freezes
    for (const sql of [
      `UPDATE registrations SET total_cents = 1 WHERE id = $1`,
      `UPDATE registrations SET purchase_snapshot = '{"version": 2}' WHERE id = $1`,
      `UPDATE registrations SET consent_ip = '1.1.1.1' WHERE id = $1`,
      `UPDATE registrations SET id = gen_random_uuid() WHERE id = $1`,
      `UPDATE registrations SET household_id = '${other.family.householdId}' WHERE id = $1`,
      `UPDATE registrations SET feis_listing_id = '${other.listing.listing.id}' WHERE id = $1`,
      `UPDATE registrations SET application_fee_cents = 1 WHERE id = $1`,
      `UPDATE registrations SET event_fee_cents = 1 WHERE id = $1`,
      `UPDATE registrations SET is_late = NOT is_late WHERE id = $1`,
      `UPDATE registrations SET consent_accepted_at = now() WHERE id = $1`,
      `UPDATE registrations SET consent_version = 'tos-changed' WHERE id = $1`,
      `UPDATE registrations SET platform_terms_version = 'platform-changed' WHERE id = $1`,
      `UPDATE registrations SET created_at = created_at - interval '1 day' WHERE id = $1`,
    ]) {
      expect(await refused(asService(db.pool, (c) => c.query(sql, [draftId]))), sql).toMatch(/contents never change/)
    }
    expect(await orderRow(draftId)).toEqual(before)
    expect(await countRows('registrations', 'household_id', other.family.householdId)).toBe(1)
  })

  it('never deletes an order', async () => {
    const { draftId } = await familyWithDraft()
    expect(await refused(asService(db.pool, (c) => c.query('DELETE FROM registrations WHERE id = $1', [draftId]))))
      .toMatch(/never deleted/)
    expect(await orderRow(draftId)).toMatchObject({ id: draftId, status: 'draft' })
  })

  it('refuses TRUNCATE of the order tables, for the service role and for the owner', async () => {
    const { family, dancer } = await familyWithDraft()
    const paidListing = await createListing(db.pool)
    await insertOrderDirect(db.pool, family.householdId, paidListing.listing.id,
      [{ dancerId: dancer.id, competitionId: paidListing.competitions[0].id }], { status: 'paid' })
    const tables = ['registrations', 'registration_entries', 'registration_snapshots']
    const counts = async () => (await db.pool.query(`
      SELECT (SELECT count(*)::int FROM registrations) AS orders,
             (SELECT count(*)::int FROM registration_entries) AS entries,
             (SELECT count(*)::int FROM registration_snapshots) AS snapshots`)).rows[0]
    const before = await counts()
    expect(Math.min(before.orders, before.entries, before.snapshots)).toBeGreaterThan(0)

    for (const table of tables) {
      expect(await refused(asService(db.pool, (c) => c.query(`TRUNCATE ${table}`))), table)
        .toMatch(new RegExp(`permission denied for table ${table}`))
    }
    // The owner keeps every privilege, so only the trigger stands in the way. CASCADE gets past the
    // foreign keys, which would otherwise refuse TRUNCATE registrations before any trigger runs.
    for (const table of tables) {
      expect(await refused(db.pool.query(`TRUNCATE ${table} CASCADE`)), table)
        .toMatch(new RegExp(`orders are never deleted, so ${table} is never truncated`))
    }
    expect(await counts()).toEqual(before)
  })

  it('sets a checkout claim once', async () => {
    const { draftId } = await familyWithDraft()
    await asService(db.pool, (c) => c.query(
      `UPDATE registrations SET checkout_claim_id = gen_random_uuid(), checkout_config = '{}', checkout_claimed_at = now(),
         checkout_expires_at = now() + interval '1 hour'
       WHERE id = $1`, [draftId]))
    const claimed = await orderRow(draftId)
    expect(claimed.checkout_claim_id).not.toBeNull()
    expect(await refused(asService(db.pool, (c) => c.query(
      `UPDATE registrations SET checkout_claim_id = gen_random_uuid() WHERE id = $1`, [draftId]))))
      .toMatch(/claim is set once/)
    expect(await orderRow(draftId)).toEqual(claimed)
  })

  it('makes a checkout claim all at once: no details without the claim, no claim without every detail', async () => {
    const { draftId } = await familyWithDraft()
    const before = await orderRow(draftId)
    for (const sql of [
      // Details while there is no claim
      `UPDATE registrations SET checkout_config = '{}' WHERE id = $1`,
      `UPDATE registrations SET checkout_claimed_at = now() WHERE id = $1`,
      `UPDATE registrations SET checkout_expires_at = now() + interval '60 minutes' WHERE id = $1`,
      // A claim missing one detail
      `UPDATE registrations SET checkout_claim_id = gen_random_uuid(), checkout_config = '{}', checkout_claimed_at = now()
       WHERE id = $1`,
      `UPDATE registrations SET checkout_claim_id = gen_random_uuid(), checkout_config = '{}',
         checkout_expires_at = now() + interval '60 minutes' WHERE id = $1`,
      `UPDATE registrations SET checkout_claim_id = gen_random_uuid(), checkout_claimed_at = now(),
         checkout_expires_at = now() + interval '60 minutes' WHERE id = $1`,
      // What claim_checkout would write for a config with no expires_at: no expiry and no hold
      `UPDATE registrations SET checkout_claim_id = gen_random_uuid(), checkout_config = '{}', checkout_claimed_at = now(),
         checkout_expires_at = NULL, hold_expires_at = NULL WHERE id = $1`,
    ]) {
      expect(await refused(asService(db.pool, (c) => c.query(sql, [draftId]))), sql)
        .toMatch(/claim time and expiry together/)
    }
    expect(await orderRow(draftId)).toEqual(before)

    await claimDraft(draftId)
    const claimed = await orderRow(draftId)
    expect(claimed.status).toBe('draft')
    const claimColumns = ['checkout_claim_id', 'checkout_config', 'checkout_claimed_at', 'checkout_expires_at']
    for (const column of [...claimColumns, 'hold_expires_at']) {
      expect(claimed[column], column).not.toBeNull()
    }
  })

  it('keeps a hold on every unpaid order', async () => {
    const draft = await familyWithDraft()
    const pending = await familyWithDraft()
    await awaitingPayment(pending.draftId)
    for (const id of [draft.draftId, pending.draftId]) {
      const before = await orderRow(id)
      expect(await refused(asService(db.pool, (c) => c.query(
        `UPDATE registrations SET hold_expires_at = NULL WHERE id = $1`, [id])))).toMatch(/registrations_unpaid_needs_hold/)
      expect(await orderRow(id)).toEqual(before)
    }
  })

  it("attaches a checkout session once and never changes a paid order's payment record", async () => {
    const { family, dancer, draftId } = await familyWithDraft()
    await claimDraft(draftId)
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

  it('writes a snapshot only for an order paid in the same transaction', async () => {
    const { family, dancer, draftId } = await familyWithDraft()
    const paidListing = await createListing(db.pool)
    const paidId = await insertOrderDirect(db.pool, family.householdId, paidListing.listing.id,
      [{ dancerId: dancer.id, competitionId: paidListing.competitions[0].id }], { status: 'paid' })

    // The marker names an order paid in an earlier transaction. It already has its snapshot, and the
    // guard (not the one-snapshot-per-order index) must be what refuses.
    expect(await refused(asService(db.pool, async (c) => {
      await c.query(`SELECT set_config('pre_registration.fulfilling_order', $1, true)`, [paidId])
      return c.query(`INSERT INTO registration_snapshots (registration_id, snapshot_data) VALUES ($1, '{}')`, [paidId])
    }))).toMatch(/written once/)
    expect(await countRows('registration_snapshots', 'registration_id', paidId)).toBe(1)

    // An unpaid order is refused too, even when its paid_at is set in the same transaction
    expect(await refused(asService(db.pool, async (c) => {
      await c.query(`UPDATE registrations SET paid_at = now() WHERE id = $1`, [draftId])
      await c.query(`SELECT set_config('pre_registration.fulfilling_order', $1, true)`, [draftId])
      return c.query(`INSERT INTO registration_snapshots (registration_id, snapshot_data) VALUES ($1, '{}')`, [draftId])
    }))).toMatch(/written once/)
    expect(await countRows('registration_snapshots', 'registration_id', draftId)).toBe(0)
    expect((await orderRow(draftId)).paid_at).toBeNull()
  })

  it('writes a snapshot only while the marker names the order', async () => {
    const { draftId } = await familyWithDraft()
    await claimDraft(draftId)
    // The order is paid in this transaction, but by the snapshot the marker names a different order
    expect(await refused(asService(db.pool, async (c) => {
      await c.query(`SELECT set_config('pre_registration.fulfilling_order', $1, true)`, [draftId])
      await c.query(
        `UPDATE registrations SET status = 'paid', paid_at = now(), confirmation_number = 'RF-X', stripe_payment_intent_id = 'pi_x',
           stripe_checkout_session_id = 'cs_x'
         WHERE id = $1`, [draftId])
      await c.query(`SELECT set_config('pre_registration.fulfilling_order', $1, true)`, [randomUUID()])
      return c.query(`INSERT INTO registration_snapshots (registration_id, snapshot_data) VALUES ($1, '{}')`, [draftId])
    }))).toMatch(/written once/)
    expect(await countRows('registration_snapshots', 'registration_id', draftId)).toBe(0)
    expect((await orderRow(draftId)).status).toBe('draft')
  })

  it('writes the snapshot when an order created in an earlier transaction is paid', async () => {
    // The real path: Submit, Pay and confirmation each commit on their own
    const { draftId } = await familyWithDraft()
    const sessionId = await awaitingPayment(draftId)
    await asService(db.pool, async (c) => {
      await fulfil(c, draftId, null)
      await c.query(
        `INSERT INTO registration_snapshots (registration_id, snapshot_data) VALUES ($1, '{"confirmed": true}')`,
        [draftId]
      )
      await c.query(`SELECT set_config('pre_registration.fulfilling_order', '', true)`)
    })
    expect(await countRows('registration_snapshots', 'registration_id', draftId)).toBe(1)
    expect(await orderRow(draftId)).toMatchObject({ status: 'paid', stripe_checkout_session_id: sessionId })
    const { rows } = await db.pool.query('SELECT created_at < paid_at AS earlier FROM registrations WHERE id = $1', [draftId])
    expect(rows[0].earlier).toBe(true)
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
        `INSERT INTO registrations (id, feis_listing_id, household_id, hold_expires_at)
         VALUES ($1, $2, $3, now() + interval '30 minutes')`,
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

  it('expires an unpaid order when the stored hold-expiry job runs after its hold has passed, and not before', async () => {
    const passedDraft = await familyWithDraft()
    const passedPending = await familyWithDraft()
    await awaitingPayment(passedPending.draftId)
    const current = await familyWithDraft()
    for (const id of [passedDraft.draftId, passedPending.draftId]) {
      await db.pool.query(`UPDATE registrations SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`, [id])
    }
    const { rows } = await db.pool.query(`SELECT command FROM cron.job WHERE jobname = 'expire-registration-holds'`)
    expect(rows).toHaveLength(1)

    // pg_cron runs a job with the default search_path, so this does too
    const client = await db.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`SET LOCAL search_path TO "$user", public`)
      await client.query(rows[0].command)
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    expect((await orderRow(passedDraft.draftId)).status).toBe('expired')
    expect((await orderRow(passedPending.draftId)).status).toBe('expired')
    expect((await orderRow(current.draftId)).status).toBe('draft')
  })
})

describe('payment evidence', () => {
  async function expectPaid(id: string, sessionId: string) {
    const row = await orderRow(id)
    expect(row).toMatchObject({ status: 'paid', stripe_checkout_session_id: sessionId, hold_expires_at: null })
    for (const column of ['checkout_claim_id', 'paid_at', 'confirmation_number', 'stripe_payment_intent_id']) {
      expect(row[column], column).not.toBeNull()
    }
  }

  it("accepts the planned writers' updates: claim, attach, pay, cancel and expire", async () => {
    // Paid after Pay attached the session: pending_payment → paid
    const usual = await familyWithDraft()
    const usualSession = await awaitingPayment(usual.draftId)
    expect((await orderRow(usual.draftId)).status).toBe('pending_payment')
    await asService(db.pool, (c) => fulfil(c, usual.draftId, usualSession))
    await expectPaid(usual.draftId, usualSession)

    // Paid through the order's own claim before Pay attached the session: draft → paid
    const early = await familyWithDraft()
    await claimDraft(early.draftId)
    const earlySession = newSessionId()
    await asService(db.pool, (c) => fulfil(c, early.draftId, earlySession))
    await expectPaid(early.draftId, earlySession)

    // A late payment on the order's own claim after expire_checkout: expired → paid
    const setStatus = (id: string, status: string) =>
      asService(db.pool, (c) => c.query(`UPDATE registrations SET status = $2 WHERE id = $1`, [id, status]))
    const late = await familyWithDraft()
    const lateSession = await awaitingPayment(late.draftId)
    await setStatus(late.draftId, 'expired')
    expect((await orderRow(late.draftId)).status).toBe('expired')
    await asService(db.pool, (c) => fulfil(c, late.draftId, lateSession))
    await expectPaid(late.draftId, lateSession)

    // cancel_order on an order awaiting payment
    const cancelled = await familyWithDraft()
    await awaitingPayment(cancelled.draftId)
    await setStatus(cancelled.draftId, 'cancelled')
    expect((await orderRow(cancelled.draftId)).status).toBe('cancelled')
  })

  it('refuses to mark an order paid without its claim, session, payment time and confirmation number', async () => {
    const unclaimed = await familyWithDraft()
    const claimed = await familyWithDraft()
    await claimDraft(claimed.draftId)
    const pending = await familyWithDraft()
    await awaitingPayment(pending.draftId)
    const attempts: [string, string][] = [
      // No claim (a session can only arrive in the same update, since a session needs a claim)
      [unclaimed.draftId, `UPDATE registrations SET status = 'paid', stripe_checkout_session_id = 'cs_x', paid_at = now(),
         confirmation_number = 'RF-X' WHERE id = $1`],
      // No session
      [claimed.draftId, `UPDATE registrations SET status = 'paid', paid_at = now(), confirmation_number = 'RF-X'
         WHERE id = $1`],
      // No payment time
      [pending.draftId, `UPDATE registrations SET status = 'paid', confirmation_number = 'RF-X' WHERE id = $1`],
      // No confirmation number
      [pending.draftId, `UPDATE registrations SET status = 'paid', paid_at = now() WHERE id = $1`],
    ]
    for (const [id, sql] of attempts) {
      const before = await orderRow(id)
      expect(await refused(asService(db.pool, (c) => c.query(sql, [id]))), sql)
        .toMatch(/a paid order needs its checkout claim, checkout session, payment time and confirmation number/)
      expect(await orderRow(id)).toEqual(before)
    }
  })

  it('marks an order paid only while the paid marker names it, after the status table and the evidence', async () => {
    const pending = await familyWithDraft()
    const sessionId = await awaitingPayment(pending.draftId)
    const before = await orderRow(pending.draftId)
    // Full payment evidence, but no marker, or a marker naming another order
    for (const marker of [null, randomUUID()]) {
      expect(await refused(asService(db.pool, async (c) => {
        if (marker) await c.query(`SELECT set_config('pre_registration.fulfilling_order', $1, true)`, [marker])
        return c.query(FULFIL_SQL, [pending.draftId, sessionId])
      }))).toMatch(/an order is marked paid only by its confirmation/)
      expect(await orderRow(pending.draftId)).toEqual(before)
    }

    // The marker never lets an illegal move through: cancelled to paid still gets the status table's message
    const cancelled = await familyWithDraft()
    await awaitingPayment(cancelled.draftId)
    await asService(db.pool, (c) => c.query(`UPDATE registrations SET status = 'cancelled' WHERE id = $1`, [cancelled.draftId]))
    expect(await refused(asService(db.pool, (c) => fulfil(c, cancelled.draftId, null))))
      .toMatch(/cannot move from cancelled to paid/)
    expect((await orderRow(cancelled.draftId)).status).toBe('cancelled')
  })

  it('pays a $0 draft with no claim, session, payment intent or charge, and nothing else at $0', async () => {
    const listing = await createListing(db.pool)
    /** A $0 draft, for a family of its own: a family holds one unpaid order per feis */
    const freeDraft = async () => {
      const family = await createFamily(db.pool)
      const dancer = await createDancer(db.pool, family.householdId)
      return insertOrderDirect(db.pool, family.householdId, listing.listing.id,
        [{ dancerId: dancer.id, competitionId: listing.competitions[0].id }], { totalCents: 0 })
    }
    // What _fulfil_order sends for a $0 order: no Stripe details at all
    const FREE_SQL = `UPDATE registrations SET status = 'paid', paid_at = now(),
        confirmation_number = 'RF-FREE-' || substr($1::text, 1, 8), hold_expires_at = NULL
      WHERE id = $1`
    const payFree = (id: string, extra = '') => asService(db.pool, async (c) => {
      await c.query(`SELECT set_config('pre_registration.fulfilling_order', $1, true)`, [id])
      if (extra) await c.query(extra, [id])
      return c.query(FREE_SQL, [id])
    })

    const ok = await freeDraft()
    await payFree(ok)
    expect(await orderRow(ok)).toMatchObject({
      status: 'paid', total_cents: 0, checkout_claim_id: null, stripe_checkout_session_id: null,
      stripe_payment_intent_id: null, stripe_charge_id: null
    })

    const refusals: [string, (id: string) => Promise<unknown>][] = [
      // With a claim (claim_checkout never claims under 50 cents, but the guard holds anyway)
      ['a claim', (id) => payFree(id, CLAIM_SQL)],
      // With a payment intent or a charge
      ['a payment intent', (id) => payFree(id, `UPDATE registrations SET stripe_payment_intent_id = 'pi_x' WHERE id = $1`)],
      ['a charge', (id) => payFree(id, `UPDATE registrations SET stripe_charge_id = 'ch_x' WHERE id = $1`)],
      // From expired rather than draft
      ['expired first', (id) => payFree(id, `UPDATE registrations SET status = 'expired' WHERE id = $1`)],
      // Without a confirmation number
      ['no confirmation number', (id) => asService(db.pool, async (c) => {
        await c.query(`SELECT set_config('pre_registration.fulfilling_order', $1, true)`, [id])
        return c.query(`UPDATE registrations SET status = 'paid', paid_at = now() WHERE id = $1`, [id])
      })],
      // Without a payment time
      ['no payment time', (id) => asService(db.pool, async (c) => {
        await c.query(`SELECT set_config('pre_registration.fulfilling_order', $1, true)`, [id])
        return c.query(
          `UPDATE registrations SET status = 'paid', confirmation_number = 'RF-FREE-' || substr($1::text, 1, 8)
           WHERE id = $1`, [id])
      })],
      // With a checkout session but no claim, set in the same update as the move into paid
      ['a session without a claim', (id) => asService(db.pool, async (c) => {
        await c.query(`SELECT set_config('pre_registration.fulfilling_order', $1, true)`, [id])
        return c.query(
          `UPDATE registrations SET status = 'paid', paid_at = now(),
             confirmation_number = 'RF-FREE-' || substr($1::text, 1, 8), stripe_checkout_session_id = 'cs_free'
           WHERE id = $1`, [id])
      })]
    ]
    for (const [label, attempt] of refusals) {
      const id = await freeDraft()
      const before = await orderRow(id)
      expect(await refused(attempt(id)), label)
        .toMatch(/a free order is paid from a draft, with its payment time and confirmation number and no checkout or payment details/)
      expect(await orderRow(id), label).toEqual(before)
    }
  })

  it('refuses to await payment without a claim and a session', async () => {
    const unclaimed = await familyWithDraft()
    const claimed = await familyWithDraft()
    await claimDraft(claimed.draftId)
    const attempts: [string, string][] = [
      // No claim
      [unclaimed.draftId, `UPDATE registrations SET status = 'pending_payment', stripe_checkout_session_id = 'cs_x'
         WHERE id = $1`],
      // No session
      [claimed.draftId, `UPDATE registrations SET status = 'pending_payment' WHERE id = $1`],
    ]
    for (const [id, sql] of attempts) {
      const before = await orderRow(id)
      expect(await refused(asService(db.pool, (c) => c.query(sql, [id]))), sql)
        .toMatch(/awaiting payment needs its checkout claim and checkout session/)
      expect(await orderRow(id)).toEqual(before)
    }
  })

  it('refuses a checkout session on an order with no claim', async () => {
    const { draftId } = await familyWithDraft()
    const before = await orderRow(draftId)
    expect(await refused(asService(db.pool, (c) => c.query(
      `UPDATE registrations SET stripe_checkout_session_id = 'cs_x' WHERE id = $1`, [draftId]))))
      .toMatch(/session needs a checkout claim/)
    expect(await orderRow(draftId)).toEqual(before)
  })
})

describe('migration 012', () => {
  it('applies again cleanly, and sets RLS and grants itself instead of relying on earlier migrations', async () => {
    const sql = readFileSync(path.join(process.cwd(), 'supabase/migrations/012_order_integrity.sql'), 'utf8')
    const client = await db.pool.connect()
    try {
      await client.query('BEGIN')
      // A hand-migrated database might have RLS off, grants to PUBLIC, or column-level grants
      await client.query(`
        ALTER TABLE registrations DISABLE ROW LEVEL SECURITY;
        ALTER TABLE registration_entries DISABLE ROW LEVEL SECURITY;
        ALTER TABLE registration_snapshots DISABLE ROW LEVEL SECURITY;
        GRANT ALL ON registrations, registration_entries, registration_snapshots TO PUBLIC;
        GRANT UPDATE (status) ON registrations TO authenticated;
        GRANT INSERT (registration_id) ON registration_entries TO anon;
        GRANT SELECT (consent_ip, checkout_config) ON registrations TO authenticated;
        GRANT SELECT (consent_ip) ON registrations TO anon;`)
      await client.query(sql)

      const { rows: rls } = await client.query(`
        SELECT relname AS tbl, relrowsecurity AS rls FROM pg_class
        WHERE relnamespace = 'pre_registration'::regnamespace
          AND relname IN ('registrations', 'registration_entries', 'registration_snapshots')
        ORDER BY relname`)
      expect(rls).toEqual([
        { tbl: 'registration_entries', rls: true },
        { tbl: 'registration_snapshots', rls: true },
        { tbl: 'registrations', rls: true },
      ])
      const { rows: grants } = await client.query(`
        SELECT c.relname AS tbl,
               CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
               a.privilege_type AS priv
        FROM pg_class c
        CROSS JOIN LATERAL aclexplode(c.relacl) AS a
        WHERE c.relnamespace = 'pre_registration'::regnamespace
          AND c.relname IN ('registrations', 'registration_entries', 'registration_snapshots')
          AND (a.grantee = 0 OR a.grantee IN ('anon'::regrole, 'authenticated'::regrole))
        ORDER BY c.relname, grantee, priv`)
      expect(grants).toEqual([
        { tbl: 'registration_entries', grantee: 'authenticated', priv: 'SELECT' },
        { tbl: 'registration_snapshots', grantee: 'authenticated', priv: 'SELECT' },
      ])
      // The stale column grants on the private columns are gone, and the column list is the one the app selects
      expect((await client.query(SELECTABLE_COLUMNS_SQL, ['authenticated'])).rows.map((r) => r.name))
        .toEqual([...READABLE_COLUMNS].sort())
      expect((await client.query(SELECTABLE_COLUMNS_SQL, ['anon'])).rows).toEqual([])
      const { rows: columnWrites } = await client.query(`
        SELECT r.role, t.tbl, p.priv
        FROM unnest(ARRAY['anon', 'authenticated']) AS r(role)
        CROSS JOIN unnest(ARRAY['registrations', 'registration_entries', 'registration_snapshots']) AS t(tbl)
        CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE']) AS p(priv)
        WHERE has_any_column_privilege(r.role, 'pre_registration.' || t.tbl, p.priv)`)
      expect(columnWrites).toEqual([])
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
})
