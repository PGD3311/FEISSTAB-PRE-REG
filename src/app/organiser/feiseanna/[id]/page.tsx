import Link from 'next/link'
import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import type {
  FeisListing,
  FeeSchedule,
  ListingStatus,
  CompetitionType,
} from '@/lib/types/feis-listing'
import { StatusActions } from '@/components/organiser/status-actions'
import { DeleteDraftButton } from '@/components/organiser/delete-draft-button'
import { CloneFeisButton } from '@/components/organiser/clone-feis-button'

export const dynamic = 'force-dynamic'

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'syllabus', label: 'Syllabus' },
  { key: 'fees', label: 'Fees' },
  { key: 'settings', label: 'Settings' },
] as const

type TabKey = (typeof TABS)[number]['key']

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

function formatDate(dateString: string | null): string {
  if (!dateString) return 'Not set'
  const date = new Date(dateString + 'T00:00:00')
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatDateTime(dateString: string | null): string {
  if (!dateString) return 'Not set'
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatCentsOrNull(cents: number | null): string {
  if (cents === null) return 'None'
  return `$${(cents / 100).toFixed(2)}`
}

interface FeisCompetition {
  id: string
  display_name: string
  competition_type: CompetitionType
  enabled: boolean
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
              {formatDate(listing.feis_date)}
              {listing.end_date && ` — ${formatDate(listing.end_date)}`}
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
              {listing.timezone ?? 'Not set'}
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
            {formatDateTime(listing.reg_closes_at)}
          </p>
        </div>
      </div>

      {/* Status actions */}
      <div className="feis-card p-5">
        <h2 className="mb-4 text-lg font-semibold">Actions</h2>
        <div className="flex flex-wrap items-center gap-3">
          <StatusActions
            listingId={listing.id}
            status={listing.status}
          />
          <Link
            href={`/organiser/feiseanna/${listing.id}/edit`}
            className="rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-muted"
          >
            Edit Details
          </Link>
          <CloneFeisButton listingId={listing.id} />
        </div>
      </div>
    </div>
  )
}

function SyllabusTab({
  competitions,
  listingId,
}: {
  competitions: FeisCompetition[]
  listingId: string
}) {
  const solos = competitions.filter((c) => c.competition_type === 'solo')
  const championships = competitions.filter(
    (c) => c.competition_type === 'championship'
  )
  const specials = competitions.filter(
    (c) =>
      c.competition_type === 'special' || c.competition_type === 'custom'
  )

  const groups: { label: string; items: FeisCompetition[] }[] = [
    { label: 'Solos', items: solos },
    { label: 'Championships', items: championships },
    { label: 'Specials', items: specials },
  ].filter((g) => g.items.length > 0)

  return (
    <div className="space-y-6">
      {competitions.length === 0 ? (
        <div className="feis-card px-6 py-12 text-center text-muted-foreground">
          No competitions configured yet.
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.label} className="feis-card p-5">
            <h2 className="mb-3 text-lg font-semibold">{group.label}</h2>
            <ul className="space-y-1.5">
              {group.items.map((comp) => (
                <li
                  key={comp.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span>{comp.display_name}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      comp.enabled
                        ? 'bg-secondary text-primary'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {comp.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

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

function FeesTab({
  feeSchedule,
  listingId,
}: {
  feeSchedule: FeeSchedule | null
  listingId: string
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
    { label: 'Family Cap', value: formatCentsOrNull(feeSchedule.family_cap_cents) },
    { label: 'Late Fee (per dancer)', value: formatCents(feeSchedule.late_fee_cents) },
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
              {formatDateTime(listing.reg_opens_at)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">
              Registration Closes
            </dt>
            <dd className="mt-0.5 font-medium">
              {formatDateTime(listing.reg_closes_at)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">
              Late Registration Closes
            </dt>
            <dd className="mt-0.5 font-medium">
              {formatDateTime(listing.late_reg_closes_at)}
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

  // Fetch fee schedule
  const { data: feeSchedule } = await supabase
    .from('fee_schedules')
    .select('*')
    .eq('feis_listing_id', id)
    .single()

  // Fetch competitions
  const { data: competitions } = await supabase
    .from('feis_competitions')
    .select('id, display_name, competition_type, enabled')
    .eq('feis_listing_id', id)
    .order('sort_order', { ascending: true })

  const typedCompetitions = (competitions ?? []) as FeisCompetition[]
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
        {activeTab === 'syllabus' && (
          <SyllabusTab
            competitions={typedCompetitions}
            listingId={id}
          />
        )}
        {activeTab === 'fees' && (
          <FeesTab
            feeSchedule={(feeSchedule as FeeSchedule) ?? null}
            listingId={id}
          />
        )}
        {activeTab === 'settings' && (
          <SettingsTab listing={typedListing} />
        )}
      </div>
    </div>
  )
}
