import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { formatDateTime } from '@/lib/format'
import type { FeisListing } from '@/lib/types/feis-listing'
import { LaunchButton } from '@/components/organiser/launch-button'

export const dynamic = 'force-dynamic'

function CheckItem({
  label,
  passed,
  detail,
}: {
  label: string
  passed: boolean
  detail?: string
}) {
  return (
    <li className="flex items-start gap-3 py-2">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          passed
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground'
        }`}
      >
        {passed ? '\u2713' : '\u2717'}
      </span>
      <div>
        <span className="text-sm font-medium">{label}</span>
        {detail && (
          <p className="text-xs text-muted-foreground">{detail}</p>
        )}
      </div>
    </li>
  )
}

export default async function LaunchPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  // Fetch listing
  const { data: listing, error: listingError } = await supabase
    .from('feis_listings')
    .select('*')
    .eq('id', id)
    .single()

  if (listingError || !listing) {
    notFound()
  }

  const typedListing = listing as FeisListing

  // Redirect if not closed or launched
  if (typedListing.status !== 'closed' && typedListing.status !== 'launched') {
    redirect(`/organiser/feiseanna/${id}`)
  }

  // Already launched — show success state
  if (typedListing.status === 'launched') {
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

        <div className="mb-6 flex items-center gap-3">
          <h1 className="text-2xl">Launch Feis Day</h1>
          <span className="inline-block rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">
            Launched
          </span>
        </div>

        <div className="feis-card border-primary/30 p-6">
          <h2 className="mb-2 text-lg font-semibold">
            This feis has been launched
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Registration data was transferred to FeisTab on{' '}
            {formatDateTime(typedListing.launched_at, 'Not set')}.
          </p>
          {typedListing.launched_event_id && (
            <p className="text-sm text-muted-foreground">
              Phase 1 Event ID:{' '}
              <code className="font-mono text-xs">
                {typedListing.launched_event_id}
              </code>
            </p>
          )}
        </div>
      </div>
    )
  }

  // Fetch all prerequisite counts in parallel (4 independent queries)
  const [
    { count: paidCount },
    { count: unsettledCount },
    { count: competitionsCount },
    { data: paidEntries },
  ] = await Promise.all([
    supabase
      .from('registrations')
      .select('id', { count: 'exact', head: true })
      .eq('feis_listing_id', id)
      .eq('status', 'paid'),
    supabase
      .from('registrations')
      .select('id', { count: 'exact', head: true })
      .eq('feis_listing_id', id)
      .in('status', ['draft', 'pending_payment']),
    supabase
      .from('feis_competitions')
      .select('id', { count: 'exact', head: true })
      .eq('feis_listing_id', id)
      .eq('enabled', true),
    supabase
      .from('registration_entries')
      .select(`
        dancer_id,
        registrations!inner(status)
      `)
      .eq('registrations.feis_listing_id', id)
      .eq('registrations.status', 'paid'),
  ])

  const uniqueDancerIds = new Set(
    (paidEntries ?? []).map((e: Record<string, unknown>) => e.dancer_id as string)
  )
  const dancerCount = uniqueDancerIds.size
  const entryCount = paidEntries?.length ?? 0

  const hasPaidRegs = (paidCount ?? 0) > 0
  const noUnsettled = (unsettledCount ?? 0) === 0
  const hasDate = !!typedListing.feis_date
  const hasCompetitions = (competitionsCount ?? 0) > 0
  const allGreen = hasPaidRegs && noUnsettled && hasDate && hasCompetitions

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

      <h1 className="mb-6 text-2xl">Launch Feis Day</h1>

      {/* Prerequisites checklist */}
      <div className="feis-card mb-6 p-5">
        <h2 className="mb-3 text-lg font-semibold">Prerequisites</h2>
        <ul className="divide-y">
          <CheckItem
            label="Registration is closed"
            passed={true}
            detail="Status is closed"
          />
          <CheckItem
            label="Feis date is set"
            passed={hasDate}
            detail={hasDate ? typedListing.feis_date! : 'No date set'}
          />
          <CheckItem
            label="Has paid registrations"
            passed={hasPaidRegs}
            detail={`${paidCount ?? 0} paid registration(s)`}
          />
          <CheckItem
            label="No unsettled registrations"
            passed={noUnsettled}
            detail={
              noUnsettled
                ? 'All registrations are settled'
                : `${unsettledCount} unsettled registration(s) remaining`
            }
          />
          <CheckItem
            label="Has enabled competitions"
            passed={hasCompetitions}
            detail={`${competitionsCount ?? 0} competition(s)`}
          />
        </ul>
      </div>

      {/* Summary */}
      <div className="feis-card mb-6 p-5">
        <h2 className="mb-3 text-lg font-semibold">What will be created</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-sm text-muted-foreground">Dancers</p>
            <p className="text-2xl font-semibold">{dancerCount}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Competitions</p>
            <p className="text-2xl font-semibold">{competitionsCount ?? 0}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Entries</p>
            <p className="text-2xl font-semibold">{entryCount}</p>
          </div>
        </div>
      </div>

      {/* Launch button */}
      <LaunchButton listingId={id} disabled={!allGreen} />
    </div>
  )
}
