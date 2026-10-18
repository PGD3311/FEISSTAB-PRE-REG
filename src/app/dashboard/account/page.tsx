import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import type { Household } from '@/lib/types/feis-listing'
import { HouseholdForm } from '@/components/household-form'
import { PageTitle } from '@/components/page-title'

export const dynamic = 'force-dynamic'

// Only same-site paths are allowed as a post-save destination
function safeNext(next: string | undefined): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null
}

export default async function FamilyDetailsPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string; welcome?: string }>
}) {
  const { next, welcome } = await searchParams
  const supabase = await createClient()
  const {
    data: { user }
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

  // A family with no dancers yet goes straight on to adding one after saving
  let hasDancers = true
  if (household) {
    const { count, error: dancersError } = await supabase
      .from('dancers')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', household.id)
      .eq('is_active', true)
    if (dancersError) console.error('Failed to count dancers:', dancersError.message)
    else hasDancers = (count ?? 0) > 0
  }
  const destination = safeNext(next) ?? (hasDancers ? null : '/dashboard/dancers/new')

  return (
    <div className="max-w-2xl">
      <PageTitle
        title={welcome ? 'Welcome to RunFeis' : 'Family details'}
        intro={
          welcome || !hasDancers
            ? 'First, tell us who you are. Next you will add your dancers.'
            : 'Who the feis contacts about your entries.'
        }
      />
      <HouseholdForm
        household={household as Household | null}
        email={user.email ?? ''}
        next={destination}
      />
    </div>
  )
}
