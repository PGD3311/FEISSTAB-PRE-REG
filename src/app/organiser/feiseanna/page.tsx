import Link from 'next/link'

import { createClient } from '@/lib/supabase/server'
import type { ListingStatus } from '@/lib/types/feis-listing'

export const dynamic = 'force-dynamic'

function StatusBadge({ status }: { status: ListingStatus }) {
  const styles: Record<ListingStatus, string> = {
    draft: 'bg-muted text-muted-foreground',
    open: 'bg-secondary text-primary',
    closed: 'bg-feis-orange-light text-feis-orange',
  }

  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${styles[status]}`}
    >
      {status}
    </span>
  )
}

function formatDate(dateString: string): string {
  const date = new Date(dateString + 'T00:00:00')
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export default async function FeiseannaPage() {
  const supabase = await createClient()
  const { data: listings, error } = await supabase
    .from('feis_listings')
    .select('id, name, feis_date, status')
    .order('feis_date', { ascending: false })

  if (error) {
    console.error('Failed to fetch listings:', error)
    return (
      <div className="py-12 text-center text-muted-foreground">
        Failed to load feiseanna. Please try again.
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl">Your Feiseanna</h1>
        <Link
          href="/organiser/feiseanna/new"
          className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          New Feis
        </Link>
      </div>

      {!listings || listings.length === 0 ? (
        <div className="feis-card px-6 py-16 text-center text-muted-foreground">
          No feiseanna yet. Create your first one.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {listings.map((listing) => (
            <Link
              key={listing.id}
              href={`/organiser/feiseanna/${listing.id}`}
              className="feis-card block px-5 py-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-foreground">
                    {listing.name}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatDate(listing.feis_date)}
                  </p>
                </div>
                <StatusBadge status={listing.status as ListingStatus} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
