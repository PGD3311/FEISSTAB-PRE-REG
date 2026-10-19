import { randomUUID } from 'node:crypto'
import pg, { Client, Pool, type PoolClient } from 'pg'
import { inject } from 'vitest'

// Return dates and timestamps as strings, the way Supabase's API does
pg.types.setTypeParser(1082, (value: string) => value) // date
pg.types.setTypeParser(1114, (value: string) => value) // timestamp
pg.types.setTypeParser(1184, (value: string) => value) // timestamptz

export type DbRole = 'authenticated' | 'anon' | 'service_role'

export interface TestDatabase {
  pool: Pool
  drop(): Promise<void>
}

/** A fresh copy of the migrated template database for one test file. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = inject('pgAdminUrl')
  const name = `t_${randomUUID().replace(/-/g, '')}`

  const admin = new Client({ connectionString: adminUrl })
  await admin.connect()
  await admin.query(`CREATE DATABASE ${name} TEMPLATE ${inject('pgTemplateDb')}`)
  await admin.query(`ALTER DATABASE ${name} SET search_path TO pre_registration, public`)
  await admin.end()

  const pool = new Pool({ connectionString: adminUrl.replace(/\/postgres$/, `/${name}`), max: 8 })

  return {
    pool,
    async drop() {
      await pool.end()
      const cleanup = new Client({ connectionString: adminUrl })
      await cleanup.connect()
      await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
      await cleanup.end()
    },
  }
}

/** Runs fn in one transaction as the given role, with JWT claims set the way PostgREST sets them. */
export async function asRole<T>(
  pool: Pool,
  role: DbRole,
  userId: string | null,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT set_config('request.jwt.claims', $1, true), set_config('role', $2, true)`, [
      JSON.stringify(userId ? { sub: userId, role } : { role }),
      role,
    ])
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

export function asParent<T>(pool: Pool, userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return asRole(pool, 'authenticated', userId, fn)
}

export function asService<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return asRole(pool, 'service_role', null, fn)
}

/** Expects the database to refuse; resolves to its error message. */
export async function refused(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (err) {
    return (err as Error).message
  }
  throw new Error('Expected the database to refuse this, but it succeeded')
}
