import Link from 'next/link'
import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import type { FeisListing, FeeSchedule, LateFeeTier } from '@/lib/types/feis-listing'
import {
  formatTimezone,
  formatDate,
  formatDateTime,
  formatCents,
  formatCentsOrNull,
  sortLateTiers
} from '@/lib/format'
import { StatusActions } from '@/components/organiser/status-actions'
import { DeleteDraftButton } from '@/components/organiser/delete-draft-button'
import { CloneFeisButton } from '@/components/organiser/clone-feis-button'
import { EntriesTab } from '@/components/organiser/entries-tab'
import {
  CompetitionEditor,
  type EditorCompetition
} from '@/components/organiser/competition-editor'
import { PageTitle } from '@/components/page-title'
import { ListingStatusTag } from '@/components/organiser/listing-status-tag'

export const dynamic = 'force-dynamic'

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'entries', label: 'Entries' },
  { key: 'syllabus', label: 'Syllabus' },
  { key: 'fees', label: 'Fees' },
  { key: 'settings', label: 'Settings' }
] as const

type TabKey = (typeof TABS)[number]['key']

/** One line of a printed summary: label, dotted leader, value. */
function LeaderLine({
  label,
  value,
  note,
  big = false
}: {
  label: string
  value: string | number
  note?: string
  big?: boolean
}) {
  return (
    <div className="py-1">
      <div className="flex items-baseline gap-1.5 text-sm">
        <span>{label}</span>
        <span className="feis-leader" />
        <span
          className={
            big ? 'feis-narrow text-[30px] leading-none tabular-nums' : 'text-right tabular-nums'
          }
        >
          {value}
        </span>
      </div>
      {note && <p className="text-[12.5px] text-muted-foreground">{note}</p>}
    </div>
  )
}

/** A ruled row of the details sheet. */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 border-t border-[#E2DCCD] px-4 py-2.5 first:border-t-0 sm:grid-cols-[140px_minmax(0,1fr)]">
      <dt className="text-[13px] font-bold text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

function NotSet() {
  return <span className="text-muted-foreground">Not set</span>
}

function SetupLink({ listingId, children }: { listingId: string; children: React.ReactNode }) {
  return (
    <Link href={`/organiser/feiseanna/${listingId}/setup`} className="feis-link text-sm">
      {children}
    </Link>
  )
}

function OverviewTab({
  listing,
  competitionsCount
}: {
  listing: FeisListing
  competitionsCount: number
}) {
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid gap-8">
        {listing.status === 'launched' && (
          <div className="border-l-4 border-[var(--color-feis-green)] bg-[var(--color-feis-green-light)] px-5 py-4">
            <h2 className="feis-display text-[20px]">Feis day launched</h2>
            <p className="mt-1 text-sm">
              The entries were sent to RunFeis for the day on{' '}
              <strong>{formatDateTime(listing.launched_at, 'an unknown date')}</strong>. This feis
              can no longer be changed here.
            </p>
            {listing.launched_event_id && (
              <p className="mt-2 text-[13px] text-muted-foreground">
                Feis-day event ID{' '}
                <code className="font-mono text-xs">{listing.launched_event_id}</code>
              </p>
            )}
          </div>
        )}

        <section>
          <h2 className="feis-display mb-2 text-[22px]">Details</h2>
          <dl className="feis-entry-form">
            <DetailRow label="Date">
              {listing.feis_date ? (
                <>
                  {formatDate(listing.feis_date, { weekday: 'long' })}
                  {listing.end_date && ` to ${formatDate(listing.end_date, { weekday: 'long' })}`}
                </>
              ) : (
                <NotSet />
              )}
            </DetailRow>
            <DetailRow label="Venue">
              {listing.venue_name ?? <NotSet />}
              {listing.venue_address && (
                <span className="block text-sm text-muted-foreground">{listing.venue_address}</span>
              )}
            </DetailRow>
            <DetailRow label="Time zone">
              {listing.timezone ? formatTimezone(listing.timezone) : <NotSet />}
            </DetailRow>
            <DetailRow label="Contact">
              {listing.contact_email ?? <NotSet />}
              {listing.contact_phone && (
                <span className="block text-sm text-muted-foreground">{listing.contact_phone}</span>
              )}
            </DetailRow>
          </dl>
        </section>

        <section>
          <h2 className="feis-display mb-3 text-[22px]">Manage this feis</h2>
          <div className="flex flex-wrap items-center gap-3">
            {listing.status !== 'launched' && (
              <>
                <StatusActions listingId={listing.id} status={listing.status} />
                {listing.status === 'closed' && (
                  <Link
                    href={`/organiser/feiseanna/${listing.id}/launch`}
                    className="feis-btn feis-btn-primary"
                  >
                    Launch feis day
                  </Link>
                )}
                <Link
                  href={`/organiser/feiseanna/${listing.id}/edit`}
                  className="feis-btn feis-btn-outline"
                >
                  Edit details
                </Link>
              </>
            )}
            <CloneFeisButton listingId={listing.id} />
          </div>
        </section>
      </div>

      <aside className="feis-receipt w-full max-w-md px-[18px] pt-5 pb-[18px] lg:max-w-none">
        <h2 className="feis-display text-[22px]">At a glance</h2>
        <p className="mb-3 text-[13px] text-muted-foreground">
          {formatDate(listing.feis_date, { fallback: 'No date set yet' })}
        </p>
        <LeaderLine label="Competitions" value={competitionsCount} big />
        <div className="mt-2.5 border-t-[3px] border-[var(--color-feis-gold)] pt-2.5">
          <p className="text-sm font-bold">Entries close</p>
          <p className="text-[22px] leading-tight font-extrabold [font-stretch:75%]">
            {formatDateTime(listing.reg_closes_at, 'Not set yet')}
          </p>
        </div>
        <p className="mt-3 text-[13px] text-muted-foreground">
          See who&apos;s entered and what&apos;s been paid on the{' '}
          <Link href={`/organiser/feiseanna/${listing.id}?tab=entries`} className="feis-link">
            Entries
          </Link>{' '}
          tab.
        </p>
      </aside>
    </div>
  )
}

function SyllabusTab({
  competitions,
  listing,
  feeSchedule
}: {
  competitions: EditorCompetition[]
  listing: FeisListing
  feeSchedule: FeeSchedule | null
}) {
  return (
    <div className="space-y-6">
      <CompetitionEditor
        listingId={listing.id}
        competitions={competitions}
        feeSchedule={feeSchedule}
        ageGroups={listing.syllabus_snapshot?.age_groups ?? []}
        editable={listing.status === 'draft' || listing.status === 'open'}
      />
      <SetupLink listingId={listing.id}>Change the syllabus in the setup steps</SetupLink>
    </div>
  )
}

function tierStart(tier: LateFeeTier, timeZone: string): string {
  return new Date(tier.starts_at).toLocaleDateString('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric'
  })
}

function FeesTab({
  feeSchedule,
  listingId,
  timeZone
}: {
  feeSchedule: FeeSchedule | null
  listingId: string
  timeZone: string
}) {
  if (!feeSchedule) {
    return (
      <div className="space-y-4">
        <div className="feis-sticker max-w-xl rounded px-5 py-5">
          <p className="font-bold">No fees set yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Families can&apos;t pay until the fees are in. Add them in the setup steps.
          </p>
        </div>
        <SetupLink listingId={listingId}>Set the fees</SetupLink>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <section className="feis-receipt max-w-md px-[18px] pt-5 pb-[18px]">
        <h2 className="feis-display mb-2 text-[22px]">Fees</h2>
        <LeaderLine
          label="Family fee"
          value={formatCents(feeSchedule.event_fee_cents)}
          note="Once per family"
        />
        <LeaderLine label="Each solo dance" value={formatCents(feeSchedule.solo_fee_cents)} />
        <LeaderLine
          label="Preliminary championship"
          value={formatCents(feeSchedule.prelim_champ_fee_cents)}
        />
        <LeaderLine
          label="Open championship"
          value={formatCents(feeSchedule.open_champ_fee_cents)}
        />
        <LeaderLine
          label="Most a family pays for entries"
          value={formatCentsOrNull(feeSchedule.family_cap_cents, 'No limit')}
        />
        {sortLateTiers(feeSchedule.late_fee_tiers).map((tier) => (
          <LeaderLine
            key={tier.starts_at}
            label={`Late fee from ${tierStart(tier, timeZone)}`}
            value={formatCents(tier.fee_cents)}
            note={
              tier.family_max_cents === null
                ? 'Per dancer'
                : `Per dancer, no more than ${formatCents(tier.family_max_cents)} a family`
            }
          />
        ))}
        <LeaderLine
          label="Entering on the day"
          value={formatCents(feeSchedule.day_of_surcharge_cents)}
          note="Extra per dancer"
        />
      </section>
      <SetupLink listingId={listingId}>Change the fees in the setup steps</SetupLink>
    </div>
  )
}

function SettingsTab({ listing }: { listing: FeisListing }) {
  return (
    <div className="grid max-w-2xl gap-8">
      <section>
        <h2 className="feis-display mb-2 text-[22px]">Deadlines</h2>
        <dl className="feis-entry-form">
          <DetailRow label="Entries open">
            {formatDateTime(listing.reg_opens_at, '') || <NotSet />}
          </DetailRow>
          <DetailRow label="Entries close">
            {formatDateTime(listing.reg_closes_at, '') || <NotSet />}
          </DetailRow>
          <DetailRow label="Late entries close">
            {formatDateTime(listing.late_reg_closes_at, '') || <NotSet />}
          </DetailRow>
        </dl>
      </section>

      <section>
        <h2 className="feis-display mb-2 text-[22px]">Payments</h2>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          Card payments through Stripe
          {listing.stripe_charges_enabled ? (
            <span className="inline-block rounded-[2px] bg-[var(--color-feis-green-light)] px-1.5 py-0.5 text-xs font-bold text-[var(--color-feis-green)]">
              Connected
            </span>
          ) : (
            <span className="inline-block rounded-[2px] bg-[var(--color-feis-orange-light)] px-1.5 py-0.5 text-xs font-bold text-[var(--color-feis-orange-ink)]">
              Not connected
            </span>
          )}
        </p>
      </section>

      {listing.status === 'draft' && (
        <section className="border-l-4 border-destructive bg-white px-5 py-4">
          <h2 className="feis-display text-[20px]">Delete this draft</h2>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">
            Removes the draft for good, with its competitions and fees. Only drafts can be deleted.
          </p>
          <DeleteDraftButton listingId={listing.id} />
        </section>
      )}
    </div>
  )
}

export default async function FeisDashboardPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { id } = await params
  const { tab: tabParam } = await searchParams
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

  // Fetch fee schedule and competitions in parallel
  const [{ data: feeSchedule }, { data: competitions }] = await Promise.all([
    supabase.from('fee_schedules').select('*').eq('feis_listing_id', id).single(),
    supabase
      .from('feis_competitions')
      .select(
        'id, display_name, display_code, competition_type, fee_category, fee_cents, exclude_from_family_cap, grades_only, enabled, age_group_label'
      )
      .eq('feis_listing_id', id)
      .order('sort_order', { ascending: true })
  ])

  const typedCompetitions = (competitions ?? []) as EditorCompetition[]
  const competitionsCount = typedCompetitions.length

  const activeTab: TabKey =
    tabParam && TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : 'overview'

  return (
    <div>
      <Link
        href="/organiser/feiseanna"
        className="mb-3 inline-block text-sm font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Back to your feiseanna
      </Link>

      <PageTitle
        title={typedListing.name || 'Untitled feis'}
        intro={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ListingStatusTag listing={typedListing} />
            <span>
              {formatDate(typedListing.feis_date, { weekday: 'long', fallback: 'No date set yet' })}
              {typedListing.venue_name ? `, ${typedListing.venue_name}` : ''}
            </span>
          </span>
        }
      />

      <nav
        aria-label="Feis sections"
        className="feis-segmented-bar mb-7 border-b-[1.5px] border-[var(--color-feis-charcoal)]"
      >
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/organiser/feiseanna/${id}?tab=${tab.key}`}
            aria-current={activeTab === tab.key ? 'page' : undefined}
            className={`feis-segmented-tab text-sm ${
              activeTab === tab.key
                ? 'feis-segmented-tab-active font-bold text-foreground'
                : 'hover:text-foreground'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="min-h-[300px]">
        {activeTab === 'overview' && (
          <OverviewTab listing={typedListing} competitionsCount={competitionsCount} />
        )}
        {activeTab === 'entries' && <EntriesTab listingId={id} />}
        {activeTab === 'syllabus' && (
          <SyllabusTab
            competitions={typedCompetitions}
            listing={typedListing}
            feeSchedule={(feeSchedule as FeeSchedule) ?? null}
          />
        )}
        {activeTab === 'fees' && (
          <FeesTab
            feeSchedule={(feeSchedule as FeeSchedule) ?? null}
            listingId={id}
            timeZone={listing.timezone ?? 'America/New_York'}
          />
        )}
        {activeTab === 'settings' && <SettingsTab listing={typedListing} />}
      </div>
    </div>
  )
}
