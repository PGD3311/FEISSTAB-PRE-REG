import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import type { Household } from '@/lib/types/feis-listing'
import { HouseholdForm } from '@/components/household-form'

export const dynamic = 'force-dynamic'

// Only same-site paths are allowed as a post-save destination
function safeNext(next: string | undefined): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null
}

export default async function FamilyDetailsPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; welcome?: string }>
}) {
  const { next, welcome } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: household, error } = await supabase
    .from('households')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    console.error('Failed to load household:', error.message)
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold">{welcome ? 'Welcome to RunFeis' : 'Family details'}</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">
        {welcome
          ? 'First, tell us who you are. Next you will add your dancers.'
          : 'Your contact details for feis registrations.'}
      </p>
      <HouseholdForm
        household={household as Household | null}
        email={user.email ?? ''}
        next={safeNext(next)}
      />
    </div>
  )
}
