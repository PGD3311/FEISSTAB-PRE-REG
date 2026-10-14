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
