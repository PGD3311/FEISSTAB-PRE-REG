import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: 'pre_registration' },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // The middleware refreshes the session cookie on the next request.
          }
        }
      }
    }
  )
}

type ServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * The signed-in user, or null for a visitor. Use this in server components instead of
 * awaiting `auth.getUser()` directly: for a visitor that call resolves to an "Auth session
 * missing" error object, and React's dev tools record awaited values, which broke
 * signed-out pages in development (see docs/known-issues.md).
 */
export async function getSignedInUser(supabase: ServerClient) {
  const { data } = await supabase.auth.getUser()
  return data.user
}
