import { redirect } from 'next/navigation'
import Link from 'next/link'

import { createClient, getSignedInUser } from '@/lib/supabase/server'
import { parseLocalDate } from '@/lib/format'
import type { ListingStatus } from '@/lib/types/feis-listing'
import { PageTitle } from '@/components/page-title'
import { ListingStatusTag } from '@/components/organiser/listing-status-tag'

export const dynamic = 'force-dynamic'

export default async function FeiseannaPage() {
  const supabase = await createClient()
  const user = await getSignedInUser(supabase)
  if (!user) redirect('/auth/login')
  const { data: listings, error } = await supabase
    .from('feis_listings')
    .select('id, name, feis_date, status, reg_closes_at, late_reg_closes_at')
    .eq('created_by', user.id)
    .order('feis_date', { ascending: false })

  const newFeisLink = (
    <Link href="/organiser/feiseanna/new" className="feis-btn feis-btn-primary">
      Set up a new feis
    </Link>
  )

  if (error) {
    console.error('Failed to fetch listings:', error)
    return (
      <div>
        <PageTitle title="Your feiseanna" />
        <p
          role="alert"
          className="max-w-xl border-l-4 border-destructive bg-white px-4 py-3 text-sm text-destructive"
        >
          Your feiseanna couldn&apos;t be loaded. Refresh the page to try again.
        </p>
      </div>
    )
  }

  const count = listings?.length ?? 0

  return (
    <div>
      <PageTitle
        title="Your feiseanna"
        intro={
          count > 0 ? (
            <>
              <span className="feis-narrow text-foreground">{count}</span>{' '}
              {count === 1 ? 'feis' : 'feiseanna'}, newest first. Open one to see its entries,
              syllabus and fees.
            </>
          ) : undefined
        }
        action={newFeisLink}
      />

      {!listings || listings.length === 0 ? (
        <div className="feis-sticker max-w-xl rounded px-5 py-5">
          <p className="font-bold">No feiseanna yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Set up your first feis with its date, venue, syllabus and fees. Next year you can copy
            it and only change what&apos;s different.
          </p>
        </div>
      ) : (
        <ul className="border-b-[1.5px] border-[var(--color-feis-charcoal)]">
          {listings.map((listing) => {
            const date = listing.feis_date ? parseLocalDate(listing.feis_date) : null
            const hasDate = date !== null && !isNaN(date.getTime())
            const href = `/organiser/feiseanna/${listing.id}`
            return (
              <li
                key={listing.id}
                className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-5 gap-y-3 border-t-[1.5px] border-[var(--color-feis-charcoal)] py-4 sm:grid-cols-[72px_minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="text-center leading-none">
                  {date && hasDate ? (
                    <>
                      <div className="feis-narrow text-[40px] leading-[0.9]">{date.getDate()}</div>
                      <div className="mt-1 text-[13px] font-bold">
                        {date.toLocaleDateString('en-GB', { month: 'short' })}
                      </div>
                      <div className="text-[12px] text-muted-foreground">{date.getFullYear()}</div>
                    </>
                  ) : (
                    <div className="text-[13px] text-muted-foreground">No date yet</div>
                  )}
                </div>

                <div className="min-w-0">
                  <Link
                    href={href}
                    className="text-[22px] leading-tight font-extrabold [font-stretch:75%] hover:underline"
                  >
                    {listing.name || 'Untitled feis'}
                  </Link>
                  <div className="mt-1">
                    <ListingStatusTag
                      listing={{ ...listing, status: listing.status as ListingStatus }}
                    />
                  </div>
                </div>

                <Link
                  href={href}
                  className="feis-btn feis-btn-outline col-start-2 justify-self-start sm:col-start-3 sm:justify-self-end"
                >
                  Manage feis
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
