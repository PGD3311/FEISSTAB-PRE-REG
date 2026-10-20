import { createClient } from '@supabase/supabase-js'

// Service-role client for server code with no user session (webhooks).
// Scoped to pre_registration: the public schema holds the Phase 1 day-of tables.
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: 'pre_registration' } }
  )
}

export type ServiceClient = ReturnType<typeof createServiceClient>

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set`)
  if (/\s/.test(value)) throw new Error(`${name} contains whitespace`)
  return value
}

// Service-role client for the feis-day (Phase 1) tables in the public schema.
// Same project and credentials as the pre-registration client above.
export function createFeisDayClient() {
  return createClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  )
}
