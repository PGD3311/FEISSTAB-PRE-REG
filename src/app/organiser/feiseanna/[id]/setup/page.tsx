import { notFound, redirect } from 'next/navigation'

import { isAwaitingApproval } from '@/lib/approval-gate'
import { createClient, getSignedInUser } from '@/lib/supabase/server'
import { FeisWizard } from '@/components/organiser/feis-wizard'
import type { FeisListing, FeeSchedule } from '@/lib/types/feis-listing'

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

  // Fetch competitions count
  const { count: competitionsCount } = await supabase
    .from('feis_competitions')
    .select('*', { count: 'exact', head: true })
    .eq('feis_listing_id', id)

  return (
    <div>
      <FeisWizard
        listing={listing as FeisListing}
        feeSchedule={(feeSchedule as FeeSchedule) ?? null}
        competitionsCount={competitionsCount ?? 0}
      />
    </div>
  )
}
