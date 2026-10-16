import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asParent, asRole, asService, createTestDatabase, refused, type TestDatabase } from './helpers/db'
import { createDancer, createFamily, createListing, insertOrderDirect } from './helpers/fixtures'

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
})

afterAll(async () => {
  await db?.drop()
})

describe('database test harness', () => {
  it('applies the migrations into the pre_registration schema', async () => {
    const { rows } = await db.pool.query(`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'pre_registration'
        AND table_name IN ('feis_listings', 'fee_schedules', 'feis_competitions', 'households',
                           'dancers', 'registrations', 'registration_entries', 'registration_snapshots')`)
    expect(rows[0].n).toBe(8)
  })

  it('reads the JWT subject through auth.uid() for the authenticated role', async () => {
    const uid = '11111111-1111-4111-8111-111111111111'
    const { rows } = await asRole(db.pool, 'authenticated', uid, (c) =>
      c.query('SELECT auth.uid() AS uid, current_user AS role')
    )
    expect(rows[0]).toEqual({ uid, role: 'authenticated' })
  })

  it('returns timestamps as strings, the way Supabase does', async () => {
    const { rows } = await db.pool.query(`SELECT now() AS at, current_date AS day`)
    expect(typeof rows[0].at).toBe('string')
    expect(rows[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('runs in UTC, as Supabase does', async () => {
    const { rows } = await db.pool.query(`SELECT current_setting('TimeZone') AS tz`)
    expect(rows[0].tz).toBe('UTC')
  })

  it("applies migration 001's seed: exactly three system syllabus templates", async () => {
    const { rows } = await db.pool.query(
      `SELECT count(*)::int AS total, (count(*) FILTER (WHERE is_system))::int AS system FROM syllabus_templates`
    )
    expect(rows[0]).toEqual({ total: 3, system: 3 })
  })

  it('keeps asRole to its own transaction, whether it commits or rolls back', async () => {
    // One connection, so each plain query runs in the very session asRole just used
    const single = new Pool({ connectionString: db.pool.options.connectionString, max: 1 })
    const plain = async () =>
      (
        await single.query(`
          SELECT pg_backend_pid() AS pid, current_user AS role, auth.uid() AS uid,
                 coalesce(current_setting('request.jwt.claims', true), '') AS claims`)
      ).rows[0]
    try {
      const uid = '22222222-2222-4222-8222-222222222222'
      const inside = await asRole(single, 'authenticated', uid, async (c) =>
        (await c.query('SELECT pg_backend_pid() AS pid, current_user AS role, auth.uid() AS uid')).rows[0]
      )
      expect(inside).toMatchObject({ role: 'authenticated', uid })
      expect(await plain()).toEqual({ pid: inside.pid, role: 'postgres', uid: null, claims: '' })

      await refused(asRole(single, 'service_role', null, (c) => c.query('SELECT 1 / 0')))
      expect(await plain()).toEqual({ pid: inside.pid, role: 'postgres', uid: null, claims: '' })
    } finally {
      await single.end()
    }
  })

  it('makes refused() fail when the statement succeeds', async () => {
    await expect(refused(db.pool.query('SELECT 1'))).rejects.toThrow(/Expected the database to refuse/)
    expect(await refused(db.pool.query('SELECT 1 / 0'))).toMatch(/division by zero/)
  })

  it('lets asService see past RLS, where a parent of another family sees nothing', async () => {
    const listing = await createListing(db.pool)
    const family = await createFamily(db.pool)
    const dancer = await createDancer(db.pool, family.householdId)
    const orderId = await insertOrderDirect(db.pool, family.householdId, listing.listing.id, [
      { dancerId: dancer.id, competitionId: listing.competitions[0].id },
    ])
    const stranger = await createFamily(db.pool)

    const seenByService = await asService(db.pool, async (c) => ({
      role: (await c.query('SELECT current_user AS role')).rows[0].role,
      ids: (await c.query('SELECT id FROM registrations WHERE id = $1', [orderId])).rows.map((r) => r.id),
    }))
    // service_role's own BYPASSRLS, not the superuser the pool connects as
    expect(seenByService).toEqual({ role: 'service_role', ids: [orderId] })

    const seenByStranger = await asParent(db.pool, stranger.userId, (c) =>
      c.query('SELECT id FROM registrations WHERE id = $1', [orderId])
    )
    expect(seenByStranger.rows).toEqual([])
  })
})
