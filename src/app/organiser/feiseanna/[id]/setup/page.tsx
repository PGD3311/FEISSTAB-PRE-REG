import { notFound, redirect } from 'next/navigation'

import { isAwaitingApproval } from '@/lib/approval-gate'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { createClient, getSignedInUser } from '@/lib/supabase/server'
import type { FeisListing, FeeSchedule } from '@/lib/types/feis-listing'
import { FeisWizard, type SetupCompetition } from '@/components/organiser/feis-wizard'

export const dynamic = 'force-dynamic'

export default async function FeisSetupPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const user = await getSignedInUser(supabase)
  if (!user) notFound()

  // Fetch listing
  const { data: listing, error: listingError } = await supabase
    .from('feis_listings')
    .select('*')
    .eq('id', id)
    .eq('created_by', user.id)
    .single()

  if (listingError || !listing) {
    notFound()
  }

  // Nothing can change while RunFeis reviews the feis; its page offers Withdraw instead
  if (isAwaitingApproval(listing.status)) {
    redirect(`/organiser/feiseanna/${id}`)
  }

  // Fetch fee schedule
  const { data: feeSchedule } = await supabase
    .from('fee_schedules')
    .select('*')
    .eq('feis_listing_id', id)
    .single()

  // Every competition's type, read in pages (PostgREST returns at most 1000 rows per request):
  // the Review step counts them and checks them before submitting
  const competitions = await fetchAllRows<SetupCompetition>((from, to) =>
    supabase
      .from('feis_competitions')
      .select('competition_type, championship_key, fee_category', { count: 'exact' })
      .eq('feis_listing_id', id)
      .order('id', { ascending: true })
      .range(from, to)
  )

  return (
    <div>
      <FeisWizard
        listing={listing as FeisListing}
        feeSchedule={(feeSchedule as FeeSchedule) ?? null}
        competitions={competitions}
      />
    </div>
  )
}
