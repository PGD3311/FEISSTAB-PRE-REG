import { notFound } from 'next/navigation'

import { createClient, getSignedInUser } from '@/lib/supabase/server'
import { OrganiserProfileForm } from '@/components/organiser/organiser-profile-form'
import { PageTitle } from '@/components/page-title'

export const dynamic = 'force-dynamic'

// Only same-site paths are allowed as a post-save destination
function safeNext(next: string | undefined): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null
}

export default async function OrganiserProfilePage({
  searchParams
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const supabase = await createClient()
  const user = await getSignedInUser(supabase)
  if (!user) notFound()

  const { data: profile, error } = await supabase
    .from('organiser_profiles')
    .select('full_name, organisation, region, phone')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    console.error('Failed to load organiser details:', error.message)
  }

  return (
    <div className="max-w-2xl">
      <PageTitle
        title="Your organiser details"
        intro="RunFeis checks every feis before it takes entries. These details tell us who is running it."
      />
      {error ? (
        <p
          role="alert"
          className="border-l-4 border-destructive bg-white px-4 py-3 text-sm text-destructive"
        >
          Your details could not be loaded. Refresh the page to try again.
        </p>
      ) : (
        <OrganiserProfileForm profile={profile} email={user.email ?? ''} next={safeNext(next)} />
      )}
    </div>
  )
}
