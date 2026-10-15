import Link from 'next/link'
import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import type {
  FeisListing,
  FeeSchedule,
  ListingStatus,
} from '@/lib/types/feis-listing'
import {
  formatTimezone,
  formatDate,
  formatDateTime,
  formatCents,
  formatCentsOrNull,
  formatLateTier,
  sortLateTiers,
} from '@/lib/format'
import { StatusActions } from '@/components/organiser/status-actions'
import { DeleteDraftButton } from '@/components/organiser/delete-draft-button'
import { CloneFeisButton } from '@/components/organiser/clone-feis-button'
import { EntriesTab } from '@/components/organiser/entries-tab'
import {
  CompetitionEditor,
  type EditorCompetition,
} from '@/components/organiser/competition-editor'

export const dynamic = 'force-dynamic'

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'entries', label: 'Entries' },
  { key: 'syllabus', label: 'Syllabus' },
  { key: 'fees', label: 'Fees' },
  { key: 'settings', label: 'Settings' },
] as const

type TabKey = (typeof TABS)[number]['key']

function StatusBadge({ status }: { status: ListingStatus }) {
  const styles: Record<ListingStatus, string> = {
    draft: 'bg-muted text-muted-foreground',
    open: 'bg-secondary text-primary',
    closed: 'bg-feis-orange-light text-feis-orange-ink',
    launched: 'bg-primary text-primary-foreground',
  }

  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${styles[status]}`}
    >
      {status}
    </span>
  )
}

function OverviewTab({
  listing,
  competitionsCount,
}: {
  listing: FeisListing
  competitionsCount: number
}) {
  return (
    <div className="space-y-6">
      {/* Details card */}
      <div className="feis-card p-5">
        <h2 className="mb-4 text-lg font-semibold">Details</h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">Date</dt>
            <dd className="mt-0.5 font-medium">
              {formatDate(listing.feis_date, { fallback: 'Not set' })}
              {listing.end_date && ` — ${formatDate(listing.end_date, { fallback: 'Not set' })}`}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Venue</dt>
            <dd className="mt-0.5 font-medium">
              {listing.venue_name ?? 'Not set'}
            </dd>
            {listing.venue_address && (
              <dd className="text-sm text-muted-foreground">
                {listing.venue_address}
              </dd>
            )}
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Timezone</dt>
            <dd className="mt-0.5 font-medium">
              {listing.timezone ? formatTimezone(listing.timezone) : 'Not set'}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Contact</dt>
            <dd className="mt-0.5 font-medium">
              {listing.contact_email ?? 'Not set'}
            </dd>
            {listing.contact_phone && (
              <dd className="text-sm text-muted-foreground">
                {listing.contact_phone}
              </dd>
            )}
          </div>
        </dl>
      </div>

      {/* Quick stats */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="feis-card p-5">
          <p className="text-sm text-muted-foreground">Competitions</p>
          <p className="feis-stat mt-1">{competitionsCount}</p>
        </div>
        <div className="feis-card p-5">
          <p className="text-sm text-muted-foreground">
            Registration Deadline
          </p>
          <p className="mt-1 text-lg font-semibold">
            {formatDateTime(listing.reg_closes_at, 'Not set')}
          </p>
        </div>
      </div>

      {/* Launched banner */}
      {listing.status === 'launched' && (
        <div className="feis-card border-primary/30 p-5">
          <h2 className="mb-2 text-lg font-semibold">Feis Day Launched</h2>
          <p className="text-sm text-muted-foreground">
            Registration data was transferred to RunFeis on{' '}
            {formatDateTime(listing.launched_at, 'Not set')}.
            This listing is now read-only.
          </p>
          {listing.launched_event_id && (
            <p className="mt-2 text-sm text-muted-foreground">
              Phase 1 Event ID:{' '}
              <code className="font-mono text-xs">
                {listing.launched_event_id}
              </code>
            </p>
          )}
        </div>
      )}

      {/* Status actions */}
      {listing.status !== 'launched' && (
        <div className="feis-card p-5">
          <h2 className="mb-4 text-lg font-semibold">Actions</h2>
          <div className="flex flex-wrap items-center gap-3">
            <StatusActions
              listingId={listing.id}
              status={listing.status}
            />
            {listing.status === 'closed' && (
              <Link
                href={`/organiser/feiseanna/${listing.id}/launch`}
                className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-feis-green-600"
              >
                Launch Feis Day
              </Link>
            )}
            <Link
              href={`/organiser/feiseanna/${listing.id}/edit`}
              className="rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-muted"
            >
              Edit Details
            </Link>
            <CloneFeisButton listingId={listing.id} />
          </div>
        </div>
      )}

      {/* Clone for launched listings */}
      {listing.status === 'launched' && (
        <div className="feis-card p-5">
          <h2 className="mb-4 text-lg font-semibold">Actions</h2>
          <div className="flex flex-wrap items-center gap-3">
            <CloneFeisButton listingId={listing.id} />
          </div>
        </div>
      )}
    </div>
  )
}

function SyllabusTab({
  competitions,
  listing,
  feeSchedule,
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
      <div>
        <Link
          href={`/organiser/feiseanna/${listing.id}/setup`}
          className="text-sm font-medium text-primary hover:underline"
        >
          Change the syllabus in the wizard
        </Link>
      </div>
    </div>
  )
}

function FeesTab({
  feeSchedule,
  listingId,
  timeZone,
}: {
  feeSchedule: FeeSchedule | null
  listingId: string
  timeZone: string
}) {
  if (!feeSchedule) {
    return (
      <div className="space-y-4">
        <div className="feis-card px-6 py-12 text-center text-muted-foreground">
          No fees configured.
        </div>
        <div>
          <Link
            href={`/organiser/feiseanna/${listingId}/setup`}
            className="text-sm font-medium text-primary hover:underline"
          >
            Edit in Wizard
          </Link>
        </div>
      </div>
    )
  }

  const fees = [
    { label: 'Event Fee (per family)', value: formatCents(feeSchedule.event_fee_cents) },
    { label: 'Solo Fee (per dance)', value: formatCents(feeSchedule.solo_fee_cents) },
    { label: 'Prelim Championship Fee', value: formatCents(feeSchedule.prelim_champ_fee_cents) },
    { label: 'Open Championship Fee', value: formatCents(feeSchedule.open_champ_fee_cents) },
    {
      label: 'Competition Entry Max (per family)',
      value: formatCentsOrNull(feeSchedule.family_cap_cents, 'None'),
    },
    ...sortLateTiers(feeSchedule.late_fee_tiers).map((tier, i) => ({
      label: `Late Fee, Tier ${i + 1}`,
      value: formatLateTier(tier, timeZone),
    })),
    { label: 'Day-of Surcharge (per dancer)', value: formatCents(feeSchedule.day_of_surcharge_cents) },
  ]

  return (
    <div className="space-y-4">
      <div className="feis-card overflow-hidden">
        <table className="w-full">
          <thead className="feis-thead">
            <tr>
              <th className="text-left">Fee Category</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="feis-tbody">
            {fees.map((fee) => (
              <tr key={fee.label}>
                <td className="px-4 py-3 text-sm">{fee.label}</td>
                <td className="px-4 py-3 text-right text-sm font-medium">
                  {fee.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <Link
          href={`/organiser/feiseanna/${listingId}/setup`}
          className="text-sm font-medium text-primary hover:underline"
        >
          Edit in Wizard
        </Link>
      </div>
    </div>
  )
}

function SettingsTab({ listing }: { listing: FeisListing }) {
  return (
    <div className="space-y-6">
      {/* Deadlines */}
      <div className="feis-card p-5">
        <h2 className="mb-4 text-lg font-semibold">Deadlines</h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">
              Registration Opens
            </dt>
            <dd className="mt-0.5 font-medium">
              {formatDateTime(listing.reg_opens_at, 'Not set')}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">
              Registration Closes
            </dt>
            <dd className="mt-0.5 font-medium">
              {formatDateTime(listing.reg_closes_at, 'Not set')}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">
              Late Registration Closes
            </dt>
            <dd className="mt-0.5 font-medium">
              {formatDateTime(listing.late_reg_closes_at, 'Not set')}
            </dd>
          </div>
        </dl>
      </div>

      {/* Stripe */}
      <div className="feis-card p-5">
        <h2 className="mb-4 text-lg font-semibold">Payments</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm">Stripe:</span>
          {listing.stripe_charges_enabled ? (
            <span className="inline-block rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-primary">
              Connected
            </span>
          ) : (
            <span className="inline-block rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              Not Connected
            </span>
          )}
        </div>
      </div>

      {/* Delete */}
      {listing.status === 'draft' && (
        <div className="feis-card border-destructive/30 p-5">
          <h2 className="mb-2 text-lg font-semibold">Danger Zone</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Deleting a draft listing permanently removes it along with all
            associated competitions and fee schedules.
          </p>
          <DeleteDraftButton listingId={listing.id} />
        </div>
      )}
    </div>
  )
}

export default async function FeisDashboardPage({
  params,
  searchParams,
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
      .order('sort_order', { ascending: true }),
  ])

  const typedCompetitions = (competitions ?? []) as EditorCompetition[]
  const competitionsCount = typedCompetitions.length

  const activeTab: TabKey =
    tabParam && TABS.some((t) => t.key === tabParam)
      ? (tabParam as TabKey)
      : 'overview'

  return (
    <div>
      {/* Header */}
      <div className="mb-2">
        <Link
          href="/organiser/feiseanna"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to Feiseanna
        </Link>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl">
            {typedListing.name ?? 'Untitled Feis'}
          </h1>
          <StatusBadge status={typedListing.status} />
        </div>
      </div>

      {/* Tab bar */}
      <div className="feis-segmented-bar mb-6">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/organiser/feiseanna/${id}?tab=${tab.key}`}
            className={`feis-segmented-tab ${
              activeTab === tab.key ? 'feis-segmented-tab-active' : ''
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-[300px]">
        {activeTab === 'overview' && (
          <OverviewTab
            listing={typedListing}
            competitionsCount={competitionsCount}
          />
        )}
        {activeTab === 'entries' && (
          <EntriesTab listingId={id} />
        )}
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
        {activeTab === 'settings' && (
          <SettingsTab listing={typedListing} />
        )}
      </div>
    </div>
  )
}
