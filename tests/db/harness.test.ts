import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asRole, createTestDatabase, type TestDatabase } from './helpers/db'

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
})

afterAll(async () => {
  await db.drop()
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
})
