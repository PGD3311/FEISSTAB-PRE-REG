import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from './helpers/db'

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
})

afterAll(async () => {
  await db?.drop()
})

describe('the live verification script', () => {
  it('passes every check against the migrated local database, and leaves nothing behind', async () => {
    const script = readFileSync('supabase/tests/payment_hardening_live_tests.sql', 'utf8')
    const client = await db.pool.connect()
    let message = ''
    try {
      await client.query('BEGIN')
      await client.query(script).catch((err: Error) => {
        message = err.message
      })
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
    expect(message).toMatch(/^PAYMENT HARDENING LIVE TESTS: (\d+)\/\1 passed; FAILED: none$/)
    const { rows } = await db.pool.query(`SELECT count(*)::int AS n FROM feis_listings WHERE name = 'Payment Hardening Test Feis'`)
    expect(rows[0].n).toBe(0)
  })
})
