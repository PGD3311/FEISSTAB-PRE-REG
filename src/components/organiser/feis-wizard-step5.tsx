'use client'

import { useState, useEffect, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'

import type {
  FeisListing,
  FeeSchedule,
  ListingTransitionContext,
} from '@/lib/types/feis-listing'
import { getListingTransitionBlockReasons } from '@/lib/feis-listing-states'
import { formatTimezone } from '@/lib/format'
import { useSupabase } from '@/hooks/use-supabase'
import { transitionListingStatus } from '@/app/organiser/feiseanna/actions'
import { PublishChecklist } from '@/components/organiser/publish-checklist'

function formatCents(cents: number | null): string {
  if (cents === null || cents === undefined) return 'N/A'
  return `$${(cents / 100).toFixed(2)}`
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Not set'
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return 'Not set'
  const dateStr = ts.split('T')[0]
  return formatDate(dateStr)
}

interface CompetitionSummary {
  total: number
  solos: number
  championships: number
  specials: number
}

interface FeisWizardStep5Props {
  listing: FeisListing
  feeSchedule: FeeSchedule | null
  competitionsCount: number
  onBack: () => void
}

export function FeisWizardStep5({
  listing,
  feeSchedule,
  competitionsCount,
  onBack,
}: FeisWizardStep5Props) {
  const router = useRouter()
  const supabase = useSupabase()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [stripeSimulated, setStripeSimulated] = useState(
    listing.stripe_charges_enabled
  )
  const [competitionSummary, setCompetitionSummary] =
    useState<CompetitionSummary>({
      total: competitionsCount,
      solos: 0,
      championships: 0,
      specials: 0,
    })
  const [enabledCompetitions, setEnabledCompetitions] = useState<
    ListingTransitionContext['enabledCompetitions']
  >([])

  // Fetch competition breakdown on mount
  useEffect(() => {
    async function fetchCompetitions() {
      const { data } = await supabase
        .from('feis_competitions')
        .select('competition_type, championship_key, fee_category')
        .eq('feis_listing_id', listing.id)

      if (data) {
        setEnabledCompetitions(data)
        const solos = data.filter(
          (c) => c.competition_type === 'solo'
        ).length
        const championships = data.filter(
          (c) => c.competition_type === 'championship'
        ).length
        const specials = data.filter(
          (c) =>
            c.competition_type === 'special' ||
            c.competition_type === 'custom'
        ).length
        setCompetitionSummary({
          total: data.length,
          solos,
          championships,
          specials,
        })
      }
    }
    fetchCompetitions()
  }, [supabase, listing.id])

  // Build the effective listing state (with simulated stripe)
  const effectiveListing = useMemo(
    () => ({
      ...listing,
      stripe_charges_enabled: stripeSimulated,
    }),
    [listing, stripeSimulated]
  )

  // Compute publish validation
  const { blocks, warnings } = useMemo(() => {
    const context: ListingTransitionContext = {
      listing: effectiveListing,
      feeSchedule,
      enabledCompetitions,
    }
    return getListingTransitionBlockReasons('draft', 'open', context)
  }, [effectiveListing, feeSchedule, enabledCompetitions])

  // Compute positive checks for the checklist
  const passed = useMemo(() => {
    const items: string[] = []
    if (listing.name) items.push('Feis name set')
    if (listing.feis_date) items.push('Feis date set')
    if (listing.venue_name) items.push('Venue set')
    if (competitionSummary.total > 0) items.push('Syllabus configured')
    if (feeSchedule) items.push('Fees configured')
    if (listing.reg_opens_at && listing.reg_closes_at)
      items.push('Deadlines set')
    if (stripeSimulated) items.push('Stripe connected')
    if (listing.privacy_policy_url) items.push('Privacy policy set')
    return items
  }, [listing, feeSchedule, competitionSummary.total, stripeSimulated])

  async function handleSimulateStripe() {
    const { error: updateError } = await supabase
      .from('feis_listings')
      .update({ stripe_charges_enabled: true })
      .eq('id', listing.id)

    if (updateError) {
      console.error('Failed to simulate Stripe:', updateError)
      return
    }
    setStripeSimulated(true)
    router.refresh()
  }

  function handlePublish() {
    if (blocks.length > 0) return

    setError(null)
    startTransition(async () => {
      try {
        const result = await transitionListingStatus(listing.id, 'open')
        if ('error' in result) {
          setError(result.error as string)
          return
        }
        window.location.href = `/organiser/feiseanna/${listing.id}`
      } catch (err) {
        console.error('Failed to publish:', err)
        setError('An unexpected error occurred while publishing.')
      }
    })
  }

  return (
    <div>
      {error && (
        <div className="mb-6 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">Review &amp; Publish</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Review your feis setup before publishing. Once published,
            registration will be open to parents.
          </p>
        </div>

        {/* Feis Details Summary */}
        <div className="feis-card px-5 py-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Feis Details
          </h3>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Name</dt>
              <dd className="font-medium">{listing.name || 'Not set'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Date</dt>
              <dd className="font-medium">
                {formatDate(listing.feis_date)}
                {listing.end_date && ` \u2013 ${formatDate(listing.end_date)}`}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Venue</dt>
              <dd className="font-medium">
                {listing.venue_name || 'Not set'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Timezone</dt>
              <dd className="font-medium">
                {listing.timezone ? formatTimezone(listing.timezone) : 'Not set'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Contact</dt>
              <dd className="font-medium">
                {listing.contact_email || 'Not set'}
              </dd>
            </div>
            {listing.contact_phone && (
              <div>
                <dt className="text-muted-foreground">Phone</dt>
                <dd className="font-medium">{listing.contact_phone}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* Syllabus Summary */}
        <div className="feis-card px-5 py-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Syllabus
          </h3>
          <p className="text-sm">
            <span className="font-medium">{competitionSummary.total}</span>{' '}
            competitions
            {competitionSummary.total > 0 && (
              <>
                {' '}
                ({competitionSummary.solos} solos,{' '}
                {competitionSummary.championships} championships,{' '}
                {competitionSummary.specials} specials)
              </>
            )}
          </p>
        </div>

        {/* Fees Summary */}
        <div className="feis-card px-5 py-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Fees
          </h3>
          {feeSchedule ? (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between sm:block">
                <dt className="text-muted-foreground">Event Fee</dt>
                <dd className="font-medium font-mono">
                  {formatCents(feeSchedule.event_fee_cents)}
                </dd>
              </div>
              <div className="flex justify-between sm:block">
                <dt className="text-muted-foreground">Solo Fee</dt>
                <dd className="font-medium font-mono">
                  {formatCents(feeSchedule.solo_fee_cents)}
                </dd>
              </div>
              <div className="flex justify-between sm:block">
                <dt className="text-muted-foreground">Prelim Champ Fee</dt>
                <dd className="font-medium font-mono">
                  {formatCents(feeSchedule.prelim_champ_fee_cents)}
                </dd>
              </div>
              <div className="flex justify-between sm:block">
                <dt className="text-muted-foreground">Open Champ Fee</dt>
                <dd className="font-medium font-mono">
                  {formatCents(feeSchedule.open_champ_fee_cents)}
                </dd>
              </div>
              <div className="flex justify-between sm:block">
                <dt className="text-muted-foreground">Family Cap</dt>
                <dd className="font-medium font-mono">
                  {feeSchedule.family_cap_cents !== null
                    ? formatCents(feeSchedule.family_cap_cents)
                    : 'No cap'}
                </dd>
              </div>
              <div className="flex justify-between sm:block">
                <dt className="text-muted-foreground">Late Fee</dt>
                <dd className="font-medium font-mono">
                  {formatCents(feeSchedule.late_fee_cents)}
                </dd>
              </div>
              <div className="flex justify-between sm:block">
                <dt className="text-muted-foreground">Day-of Surcharge</dt>
                <dd className="font-medium font-mono">
                  {formatCents(feeSchedule.day_of_surcharge_cents)}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              No fee schedule set.
            </p>
          )}
        </div>

        {/* Deadlines Summary */}
        <div className="feis-card px-5 py-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Deadlines
          </h3>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Registration Opens</dt>
              <dd className="font-medium">
                {formatTimestamp(listing.reg_opens_at)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Registration Closes</dt>
              <dd className="font-medium">
                {formatTimestamp(listing.reg_closes_at)}
              </dd>
            </div>
            {listing.late_reg_closes_at && (
              <div>
                <dt className="text-muted-foreground">
                  Late Registration Closes
                </dt>
                <dd className="font-medium">
                  {formatTimestamp(listing.late_reg_closes_at)}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground">Dancer Cap</dt>
              <dd className="font-medium">
                {listing.dancer_cap ?? 'Unlimited'}
              </dd>
            </div>
          </dl>
        </div>

        {/* Stripe Connect */}
        <div className="feis-card px-5 py-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Payment Processing
          </h3>
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                stripeSimulated
                  ? 'bg-green-100 text-green-800'
                  : 'bg-red-100 text-red-800'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  stripeSimulated ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
              {stripeSimulated ? 'Connected' : 'Not connected'}
            </span>
            {!stripeSimulated && (
              <button
                type="button"
                onClick={handleSimulateStripe}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-feis-green-600"
              >
                Connect Stripe Account
              </button>
            )}
          </div>
          {!stripeSimulated && (
            <p className="mt-2 text-xs text-muted-foreground">
              Stripe integration is simulated for now. Click to mark as
              connected.
            </p>
          )}
        </div>

        {/* Publish Checklist */}
        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Publish Checklist
          </h3>
          <PublishChecklist blocks={blocks} warnings={warnings} passed={passed} />
        </div>
      </div>

      {/* Navigation */}
      <div className="mt-8 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-muted"
        >
          Back
        </button>
        <div className="flex flex-col items-start gap-1">
          {blocks.length > 0 && (
            <p className="text-sm font-medium text-destructive">
              Fix the items above before publishing.
            </p>
          )}
          <button
            type="button"
            onClick={handlePublish}
            disabled={isPending || blocks.length > 0}
            className={`rounded-md px-4 py-2 text-sm font-medium ${
              blocks.length > 0
                ? 'cursor-not-allowed bg-muted text-muted-foreground opacity-50'
                : 'bg-primary text-primary-foreground hover:bg-feis-green-600 disabled:cursor-not-allowed disabled:opacity-40'
            }`}
          >
            {isPending
              ? 'Publishing...'
              : blocks.length > 0
                ? 'Cannot Publish'
                : 'Publish Feis'}
          </button>
        </div>
      </div>
    </div>
  )
}
