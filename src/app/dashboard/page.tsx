import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  // Check if household exists
  const { data: household } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!household) {
    redirect('/auth/onboarding')
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Dashboard</h1>
      <div className="feis-card px-6 py-12 text-center">
        <p className="text-muted-foreground">No registrations yet.</p>
        <p className="mt-2 text-sm text-muted-foreground">Browse open feiseanna to get started.</p>
        <Link
          href="/feiseanna"
          className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-[var(--color-feis-green-600)]"
        >
          Browse Feiseanna
        </Link>
      </div>
    </div>
  )
}
