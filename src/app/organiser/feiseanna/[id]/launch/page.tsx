import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { formatDate, formatDateTime } from '@/lib/format'
import type { FeisListing } from '@/lib/types/feis-listing'
import { LaunchButton } from '@/components/organiser/launch-button'
import { PageTitle } from '@/components/page-title'

export const dynamic = 'force-dynamic'

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function CheckItem({ label, passed, detail }: { label: string; passed: boolean; detail?: string }) {
  return (
    <li className="flex items-start gap-3 border-t border-[#E2DCCD] py-2.5 first:border-t-0">
      <span
        aria-hidden="true"
        className={`mt-px grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[2px] border-[1.5px] bg-white text-[13px] leading-none font-black ${
          passed
            ? 'border-[var(--color-feis-charcoal)] text-[var(--color-feis-green)]'
            : 'border-[var(--color-feis-orange-ink)] text-[var(--color-feis-orange-ink)]'
        }`}
      >
        {passed ? '✓' : '✗'}
      </span>
      <div>
        <span className="text-sm font-bold">
          <span className="sr-only">{passed ? 'Done: ' : 'Not yet: '}</span>
          {label}
        </span>
        {detail && (
          <p
            className={`text-[13px] ${passed ? 'text-muted-foreground' : 'text-[var(--color-feis-orange-ink)]'}`}
          >
            {detail}
          </p>
        )}
      </div>
    </li>
  )
}

function CountLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5 py-0.5">
      <span className="text-sm">{label}</span>
      <span className="feis-leader" />
      <span className="feis-narrow text-[30px] leading-none tabular-nums">{value}</span>
    </div>
  )
}

function BackLink({ id }: { id: string }) {
  return (
    <Link
      href={`/organiser/feiseanna/${id}`}
      className="mb-3 inline-block text-sm font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground"
    >
      Back to this feis
    </Link>
  )
}

export default async function LaunchPage({ params }: { params: Promise<{ id: string }> }) {
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
        <BackLink id={id} />
        <PageTitle
          title="Feis day launched"
          intro={typedListing.name ? `${typedListing.name} has been sent to RunFeis.` : undefined}
        />

        <div className="max-w-2xl border-l-4 border-[var(--color-feis-green)] bg-[var(--color-feis-green-light)] px-5 py-4">
          <p className="text-sm">
            The entries were sent to RunFeis for the day on{' '}
            <strong>{formatDateTime(typedListing.launched_at, 'an unknown date')}</strong>. This
            feis can no longer be changed here.
          </p>
          {typedListing.launched_event_id && (
            <p className="mt-2 text-[13px] text-muted-foreground">
              Feis-day event ID{' '}
              <code className="font-mono text-xs">{typedListing.launched_event_id}</code>
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
    { data: paidEntries }
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
      .select(
        `
        dancer_id,
        registrations!inner(status)
      `
      )
      .eq('registrations.feis_listing_id', id)
      .eq('registrations.status', 'paid')
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
      <BackLink id={id} />
      <PageTitle
        title="Launch feis day"
        intro="Sends the paid entries to RunFeis for the day: the competitions, the dancers and who's dancing in what. Do this once entries have closed and every payment is settled."
      />

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-6">
          <section>
            <h2 className="feis-display mb-2 text-[22px]">Before you launch</h2>
            <ul className="border-y-[1.5px] border-[var(--color-feis-charcoal)]">
              <CheckItem
                label="Entries are closed"
                passed={true}
                detail="No new entries can come in"
              />
              <CheckItem
                label="The feis date is set"
                passed={hasDate}
                detail={
                  hasDate ? formatDate(typedListing.feis_date) : 'Add the date in the feis details'
                }
              />
              <CheckItem
                label="There are paid registrations"
                passed={hasPaidRegs}
                detail={plural(paidCount ?? 0, 'paid registration', 'paid registrations')}
              />
              <CheckItem
                label="No registrations are left unpaid"
                passed={noUnsettled}
                detail={
                  noUnsettled
                    ? 'Every registration is paid, expired or cancelled'
                    : `${plural(unsettledCount ?? 0, 'registration is', 'registrations are')} unfinished or waiting for payment`
                }
              />
              <CheckItem
                label="There are competitions switched on"
                passed={hasCompetitions}
                detail={plural(competitionsCount ?? 0, 'competition', 'competitions')}
              />
            </ul>
          </section>

          <LaunchButton listingId={id} disabled={!allGreen} />
        </div>

        <aside className="feis-receipt px-[18px] pt-5 pb-[18px]">
          <h2 className="feis-display text-[22px]">What goes to feis day</h2>
          <p className="mb-3 text-[13px] text-muted-foreground">Paid entries only</p>
          <CountLine label="Dancers" value={dancerCount} />
          <CountLine label="Competitions" value={competitionsCount ?? 0} />
          <div className="mt-2.5 flex items-baseline justify-between border-t-[3px] border-[var(--color-feis-gold)] pt-2.5">
            <span className="font-bold">Entries</span>
            <strong className="feis-narrow text-[44px] leading-none tabular-nums">
              {entryCount}
            </strong>
          </div>
        </aside>
      </div>
    </div>
  )
}
