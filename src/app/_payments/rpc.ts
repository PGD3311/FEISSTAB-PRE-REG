import type { ServiceClient } from '@/lib/supabase/service'

/** Calls a pre_registration database function by name, with named arguments. */
export type RpcCaller = (fn: string, args: Record<string, unknown>) => Promise<unknown>

export function supabaseRpc(client: ServiceClient): RpcCaller {
  return async (fn, args) => {
    const { data, error } = await client.rpc(fn, args)
    if (error) throw new Error(`${fn} failed: ${error.message}`)
    return data
  }
}
