import { notFound } from 'next/navigation'

import {
  formatCents,
  formatCentsOrNull,
  formatDate,
  formatDateTime,
  formatTimezone
} from '@/lib/format'
import { createClient, getSignedInUser } from '@/lib/supabase/server'
import type { FeeSchedule, FeisListing } from '@/lib/types/feis-listing'
import { organiserEmail } from '@/app/_approvals/approval-email'
import { ApprovalActions } from '@/components/admin/approval-actions'
import { PageTitle } from '@/components/page-title'

export const dynamic = 'force-dynamic'

type PendingListing = Pick<
  FeisListing,
  | 'id'
  | 'name'
  | 'feis_date'
  | 'end_date'
  | 'venue_name'
  | 'venue_address'
  | 'timezone'
  | 'contact_email'
  | 'reg_opens_at'
  | 'reg_closes_at'
  | 'late_reg_closes_at'
  | 'sanction_region'
  | 'sanction_reference'
  | 'sanction_notes'
  | 'submitted_at'
  | 'created_by'
>

type ApprovedListing = Pick<FeisListing, 'id' | 'name' | 'feis_date' | 'status' | 'approved_at'>

interface OrganiserProfile {
  user_id: string
  full_name: string
  organisation: string
  region: string
  phone: string | null
}

type FeeSummary = Pick<
  FeeSchedule,
  | 'feis_listing_id'
  | 'event_fee_cents'
  | 'solo_fee_cents'
  | 'prelim_champ_fee_cents'
  | 'open_champ_fee_cents'
  | 'family_cap_cents'
  | 'day_of_surcharge_cents'
  | 'late_fee_tiers'
>

interface ReviewItem {
  listing: PendingListing
  organiser: OrganiserProfile | null
  email: string | null
  fees: FeeSummary | null
  enabledCompetitions: number | null
}

class LoadError extends Error {}

/** Everything the admin needs to decide on each feis waiting for approval */
async function loadReviewItems(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await supabase
    .from('feis_listings')
    .select(
      'id, name, feis_date, end_date, venue_name, venue_address, timezone, contact_email, reg_opens_at, reg_closes_at, late_reg_closes_at, sanction_region, sanction_reference, sanction_notes, submitted_at, created_by'
    )
    .eq('status', 'pending_review')
    .order('submitted_at', { ascending: true, nullsFirst: true })
  if (error) throw new LoadError(`feis listings: ${error.message}`)
  const listings = (data ?? []) as PendingListing[]
  if (listings.length === 0) return []

  const ids = listings.map((l) => l.id)
  const owners = [...new Set(listings.map((l) => l.created_by).filter((id): id is string => !!id))]

  const [feesResult, profilesResult, counts, emails] = await Promise.all([
    supabase
      .from('fee_schedules')
      .select(
        'feis_listing_id, event_fee_cents, solo_fee_cents, prelim_champ_fee_cents, open_champ_fee_cents, family_cap_cents, day_of_surcharge_cents, late_fee_tiers'
      )
      .in('feis_listing_id', ids),
    owners.length > 0
      ? supabase
          .from('organiser_profiles')
          .select('user_id, full_name, organisation, region, phone')
          .in('user_id', owners)
      : Promise.resolve({ data: [], error: null }),
    Promise.all(
      ids.map(async (id) => {
        const { count, error: countError } = await supabase
          .from('feis_competitions')
          .select('id', { count: 'exact', head: true })
          .eq('feis_listing_id', id)
          .eq('enabled', true)
        if (countError) {
          console.error(`Failed to count competitions for ${id}:`, countError.message)
          return [id, null] as const
        }
        return [id, count ?? 0] as const
      })
    ),
    // The service client reads each organiser's sign-in email, for display only
    Promise.all(owners.map(async (owner) => [owner, await organiserEmail(owner)] as const))
  ])
  if (feesResult.error) throw new LoadError(`fee schedules: ${feesResult.error.message}`)
  if (profilesResult.error) {
    throw new LoadError(`organiser details: ${profilesResult.error.message}`)
  }

  const fees = new Map(((feesResult.data ?? []) as FeeSummary[]).map((f) => [f.feis_listing_id, f]))
  const profiles = new Map(
    ((profilesResult.data ?? []) as OrganiserProfile[]).map((p) => [p.user_id, p])
  )
  const competitionCounts = new Map(counts)
  const emailByOwner = new Map(emails)

  return listings.map((listing): ReviewItem => ({
    listing,
    organiser: listing.created_by ? (profiles.get(listing.created_by) ?? null) : null,
    email: listing.created_by ? (emailByOwner.get(listing.created_by) ?? null) : null,
    fees: fees.get(listing.id) ?? null,
    enabledCompetitions: competitionCounts.get(listing.id) ?? null
  }))
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 border-t border-[#E2DCCD] py-2 first:border-t-0 sm:grid-cols-[150px_minmax(0,1fr)]">
      <dt className="text-[13px] font-bold text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  )
}

function Missing({ children = 'Not given' }: { children?: string }) {
  return <span className="font-semibold text-destructive">{children}</span>
}

function ReviewCard({ item }: { item: ReviewItem }) {
  const { listing, organiser, email, fees, enabledCompetitions } = item
  const timeZone = listing.timezone ?? 'America/New_York'
  return (
    <li className="feis-entry-form px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="feis-display text-[22px]">{listing.name || 'Untitled feis'}</h2>
        <p className="text-[13px] text-muted-foreground">
          Submitted {formatDateTime(listing.submitted_at, 'at an unknown time', timeZone)}
        </p>
      </div>

      <div className="mt-3 grid gap-x-8 lg:grid-cols-2">
        <dl>
          <Row label="Date">
            {formatDate(listing.feis_date, { weekday: 'long', fallback: 'Not set' })}
            {listing.end_date && ` to ${formatDate(listing.end_date, { weekday: 'long' })}`}
          </Row>
          <Row label="Venue">
            {listing.venue_name ?? <Missing>Not set</Missing>}
            {listing.venue_address && (
              <span className="block text-muted-foreground">{listing.venue_address}</span>
            )}
          </Row>
          <Row label="Time zone">{formatTimezone(timeZone)}</Row>
          <Row label="Entries">
            Open {formatDateTime(listing.reg_opens_at, 'not set', timeZone)}
            <span className="block">
              Close {formatDateTime(listing.reg_closes_at, 'not set', timeZone)}
            </span>
            {listing.late_reg_closes_at && (
              <span className="block">
                Late entries close {formatDateTime(listing.late_reg_closes_at, '', timeZone)}
              </span>
            )}
          </Row>
          <Row label="Competitions">
            {enabledCompetitions === null ? (
              <Missing>Could not be counted</Missing>
            ) : (
              `${enabledCompetitions} enabled`
            )}
          </Row>
          <Row label="Fees">
            {fees ? (
              <>
                Family {formatCents(fees.event_fee_cents)}, solo {formatCents(fees.solo_fee_cents)},
                prelim {formatCents(fees.prelim_champ_fee_cents)}, open{' '}
                {formatCents(fees.open_champ_fee_cents)}
                <span className="block text-muted-foreground">
                  Family cap {formatCentsOrNull(fees.family_cap_cents, 'none')}, on the day{' '}
                  {formatCents(fees.day_of_surcharge_cents)} extra,{' '}
                  {fees.late_fee_tiers.length === 0
                    ? 'no late fees'
                    : `${fees.late_fee_tiers.length} late fee tier${fees.late_fee_tiers.length === 1 ? '' : 's'}`}
                </span>
              </>
            ) : (
              <Missing>No fees set</Missing>
            )}
          </Row>
        </dl>

        <dl>
          <Row label="Sanction region">{listing.sanction_region ?? <Missing />}</Row>
          <Row label="Sanction reference">
            <span className="font-mono">{listing.sanction_reference ?? <Missing />}</span>
          </Row>
          {listing.sanction_notes && (
            <Row label="Sanction notes">
              <span className="whitespace-pre-line">{listing.sanction_notes}</span>
            </Row>
          )}
          <Row label="Organiser">
            {organiser ? (
              <>
                {organiser.full_name}
                <span className="block text-muted-foreground">
                  {organiser.organisation}, {organiser.region}
                </span>
                {organiser.phone && <span className="block">{organiser.phone}</span>}
              </>
            ) : (
              <Missing>No organiser details</Missing>
            )}
          </Row>
          <Row label="Sign-in email">{email ?? <Missing>Could not be read</Missing>}</Row>
          <Row label="Feis contact">{listing.contact_email ?? <Missing>Not set</Missing>}</Row>
        </dl>
      </div>

      <div className="mt-4 border-t-[1.5px] border-[var(--color-feis-charcoal)] pt-4">
        <ApprovalActions listingId={listing.id} />
      </div>
    </li>
  )
}

export default async function ApprovalsPage() {
  const supabase = await createClient()
  const user = await getSignedInUser(supabase)
  if (!user) notFound()

  // The layout checks too; the page checks for itself so it never renders for anyone else
  const { data: isAdmin, error: adminError } = await supabase.rpc('is_platform_admin')
  if (adminError) console.error('Failed to check platform admin:', adminError.message)
  if (adminError || isAdmin !== true) notFound()

  let items: ReviewItem[] = []
  let loadError: string | null = null
  try {
    items = await loadReviewItems(supabase)
  } catch (err) {
    console.error('Failed to load feiseanna waiting for approval:', err)
    loadError = 'The feiseanna waiting for approval could not be loaded. Refresh to try again.'
  }

  const { data: recent, error: recentError } = await supabase
    .from('feis_listings')
    .select('id, name, feis_date, status, approved_at')
    .not('approved_at', 'is', null)
    .order('approved_at', { ascending: false })
    .limit(10)
  if (recentError) console.error('Failed to load recently approved:', recentError.message)

  return (
    <div>
      <PageTitle
        title="Feiseanna waiting for approval"
        intro="Oldest first. Check the sanction and the organiser, then approve it or send it back with a note."
      />

      {loadError ? (
        <p
          role="alert"
          className="border-l-4 border-destructive bg-white px-4 py-3 text-sm text-destructive"
        >
          {loadError}
        </p>
      ) : items.length === 0 ? (
        <p className="feis-sticker max-w-xl rounded px-5 py-5 font-bold">
          Nothing is waiting for approval.
        </p>
      ) : (
        <ul className="grid gap-6">
          {items.map((item) => (
            <ReviewCard key={item.listing.id} item={item} />
          ))}
        </ul>
      )}

      <section className="mt-12 max-w-3xl">
        <h2 className="feis-display mb-2 text-[22px]">Recently approved</h2>
        {recentError ? (
          <p role="alert" className="text-sm text-destructive">
            Could not be loaded.
          </p>
        ) : (recent ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="border-y-[1.5px] border-[var(--color-feis-charcoal)]">
            {((recent ?? []) as ApprovedListing[]).map((listing) => (
              <li
                key={listing.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 border-t border-[#E2DCCD] py-2.5 text-sm first:border-t-0"
              >
                <span>
                  <span className="font-semibold">{listing.name || 'Untitled feis'}</span>{' '}
                  <span className="text-muted-foreground">
                    {formatDate(listing.feis_date, { fallback: 'no date' })}
                  </span>
                </span>
                <span className="text-[13px] text-muted-foreground">
                  Approved {formatDateTime(listing.approved_at, '', 'America/New_York')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
