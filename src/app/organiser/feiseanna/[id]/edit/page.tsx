import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { isAwaitingApproval } from '@/lib/approval-gate'
import { createClient, getSignedInUser } from '@/lib/supabase/server'
import type { FeisListing } from '@/lib/types/feis-listing'
import { EditDetailsForm } from '@/components/organiser/edit-details-form'
import { PageTitle } from '@/components/page-title'

export const dynamic = 'force-dynamic'

export default async function EditFeisDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const user = await getSignedInUser(supabase)
  if (!user) notFound()

  const { data: listing, error: listingError } = await supabase
    .from('feis_listings')
    .select('*')
    .eq('id', id)
    .eq('created_by', user.id)
    .single()

  if (listingError || !listing) {
    notFound()
  }

  const typedListing = listing as FeisListing

  // Nothing can change while RunFeis reviews the feis; its page offers Withdraw instead
  if (isAwaitingApproval(typedListing.status)) {
    redirect(`/organiser/feiseanna/${id}`)
  }

  return (
    <div className="max-w-2xl">
      <Link
        href={`/organiser/feiseanna/${id}`}
        className="mb-3 inline-block text-sm font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Back to this feis
      </Link>
      <PageTitle title="Edit feis details" intro={typedListing.name || undefined} />

      {typedListing.status === 'open' && (
        <p className="mb-6 border-l-4 border-[var(--color-feis-orange)] bg-[var(--color-feis-orange-light)] px-4 py-2.5 text-sm text-[var(--color-feis-orange-ink)]">
          This feis is open for entries. If you change the date or venue, families who have already
          entered will see the change, so let them know.
        </p>
      )}

      <EditDetailsForm listing={typedListing} />
    </div>
  )
}
