import Link from 'next/link'
import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import type { FeisListing } from '@/lib/types/feis-listing'
import { EditDetailsForm } from '@/components/organiser/edit-details-form'

export const dynamic = 'force-dynamic'

export default async function EditFeisDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: listing, error: listingError } = await supabase
    .from('feis_listings')
    .select('*')
    .eq('id', id)
    .single()

  if (listingError || !listing) {
    notFound()
  }

  const typedListing = listing as FeisListing

  return (
    <div>
      <div className="mb-2">
        <Link
          href={`/organiser/feiseanna/${id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to Dashboard
        </Link>
      </div>

      <h1 className="mb-6 text-2xl">Edit Details</h1>

      {typedListing.status === 'open' && (
        <div className="mb-6 rounded-md border-l-4 border-feis-orange bg-feis-orange-light p-4 text-sm text-feis-orange">
          This feis has published registration. Changes to date or venue
          will affect registered families.
        </div>
      )}

      <EditDetailsForm listing={typedListing} />
    </div>
  )
}
