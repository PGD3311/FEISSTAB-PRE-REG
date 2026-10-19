import type { Pool } from 'pg'
import type { RpcCaller } from '@/app/_payments/rpc'
import { asService } from './db'

/** The same calls supabase.rpc makes, sent straight to the test database as the service role. */
export function pgRpc(pool: Pool): RpcCaller {
  return async (fn, args) => {
    const names = Object.keys(args)
    const params = names.map((name, i) => `${name} => $${i + 1}`).join(', ')
    const values = names.map((name) => {
      const value = args[name]
      if (value === undefined) return null
      return value !== null && typeof value === 'object' ? JSON.stringify(value) : value
    })
    return asService(pool, async (client) => {
      const { rows } = await client.query(
        `SELECT pre_registration.${fn}(${params}) AS result`,
        values
      )
      return rows[0]?.result ?? null
    })
  }
}
