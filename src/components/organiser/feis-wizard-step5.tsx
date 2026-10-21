'use client'

import { useState, useEffect, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'

import type { FeisListing, FeeSchedule, ListingTransitionContext } from '@/lib/types/feis-listing'
import { checklistLinkFor } from '@/lib/approval-gate'
import { getListingTransitionBlockReasons } from '@/lib/feis-listing-states'
import { competitionTypeCounts } from '@/lib/syllabus-summary'
import {
  formatTimezone,
  formatCentsOrNull,
  formatDate,
  formatDateTime,
  formatLateTier,
  sortLateTiers
} from '@/lib/format'
import { useSupabase } from '@/hooks/use-supabase'
import { transitionListingStatus } from '@/app/organiser/feiseanna/actions'
import { PublishChecklist } from '@/components/organiser/publish-checklist'

interface FeisWizardStep5Props {
  listing: FeisListing
  feeSchedule: FeeSchedule | null
  competitions: ListingTransitionContext['enabledCompetitions']
  onBack: () => void
}

export function FeisWizardStep5({
  listing,
  feeSchedule,
  competitions,
  onBack
}: FeisWizardStep5Props) {
  const router = useRouter()
  const supabase = useSupabase()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [stripeSimulated, setStripeSimulated] = useState(listing.stripe_charges_enabled)
  const competitionSummary = useMemo(() => competitionTypeCounts(competitions), [competitions])
  const [hasOrganiserProfile, setHasOrganiserProfile] = useState(false)

  // Whether the organiser has filled in their details, which submitting for approval needs
  useEffect(() => {
    async function fetchOrganiserProfile() {
      const {
        data: { user }
      } = await supabase.auth.getUser()
      if (!user) return
      const { data, error: profileError } = await supabase
        .from('organiser_profiles')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle()
      if (profileError) {
        console.error('Failed to fetch organiser details:', profileError)
        return
      }
      setHasOrganiserProfile(data !== null)
    }
    fetchOrganiserProfile()
  }, [supabase])

  // Build the effective listing state (with simulated stripe)
  const effectiveListing = useMemo(
    () => ({
      ...listing,
      stripe_charges_enabled: stripeSimulated
    }),
    [listing, stripeSimulated]
  )

  // Compute publish validation
  const { blocks, warnings } = useMemo(() => {
    const context: ListingTransitionContext = {
      listing: effectiveListing,
      feeSchedule,
      enabledCompetitions: competitions,
      hasOrganiserProfile
    }
    return getListingTransitionBlockReasons('draft', 'pending_review', context)
  }, [effectiveListing, feeSchedule, competitions, hasOrganiserProfile])

  // Compute positive checks for the checklist
  const passed = useMemo(() => {
    const items: string[] = []
    if (listing.name) items.push('Feis name set')
    if (listing.feis_date) items.push('Feis date set')
    if (listing.venue_name) items.push('Venue set')
    if (competitionSummary.total > 0) items.push('Syllabus configured')
    if (feeSchedule) items.push('Fees configured')
    if (listing.reg_opens_at && listing.reg_closes_at) items.push('Deadlines set')
    if (stripeSimulated) items.push('Stripe connected')
    if (listing.privacy_policy_url) items.push('Privacy policy set')
    if (listing.sanction_region?.trim() && listing.sanction_reference?.trim()) {
      items.push('Sanction details set')
    }
    if (hasOrganiserProfile) items.push('Your organiser details set')
    return items
  }, [listing, feeSchedule, competitionSummary.total, stripeSimulated, hasOrganiserProfile])

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

  function handleSubmitForApproval() {
    if (blocks.length > 0) return

    setError(null)
    startTransition(async () => {
      try {
        const result = await transitionListingStatus(listing.id, 'pending_review')
        if ('error' in result) {
          setError(result.error + (result.blocks ? ' ' + result.blocks.join('. ') : ''))
          return
        }
        window.location.href = `/organiser/feiseanna/${listing.id}`
      } catch (err) {
        console.error('Failed to submit for approval:', err)
        setError('Your feis could not be submitted. Check your connection and try again.')
      }
    })
  }

  const timeZone = listing.timezone ?? 'America/New_York'
  const sectionHeading = 'text-base font-extrabold [font-stretch:80%]'
  const section = 'border-t-[1.5px] border-[var(--color-feis-charcoal)] px-5 py-4 sm:px-6'
  const first = 'px-5 py-4 sm:px-6'

  return (
    <div className="max-w-3xl">
      {error && (
        <p
          role="alert"
          className="mb-6 border-l-4 border-destructive bg-white px-4 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <div className="mb-4">
        <h2 className="feis-display text-[22px]">Review and submit</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Check your feis, then submit it for approval. RunFeis checks every feis before it takes
          entries, and we&apos;ll email you when it&apos;s approved. Then parents can register.
        </p>
      </div>

      <div className="feis-entry-form">
        {/* Feis details */}
        <section className={first}>
          <h3 className={sectionHeading}>The feis</h3>
          <dl className="mt-2 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Name</dt>
              <dd className="font-semibold">{listing.name || 'Not set'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Date</dt>
              <dd className="font-semibold">
                {formatDate(listing.feis_date, {
                  weekday: 'short',
                  month: 'short',
                  fallback: 'Not set'
                })}
                {listing.end_date &&
                  ` \u2013 ${formatDate(listing.end_date, { weekday: 'short', month: 'short', fallback: 'Not set' })}`}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Venue</dt>
              <dd className="font-semibold">{listing.venue_name || 'Not set'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Time zone</dt>
              <dd className="font-semibold">
                {listing.timezone ? formatTimezone(listing.timezone) : 'Not set'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Contact email</dt>
              <dd className="font-semibold break-words">{listing.contact_email || 'Not set'}</dd>
            </div>
            {listing.contact_phone && (
              <div>
                <dt className="text-muted-foreground">Phone</dt>
                <dd className="font-semibold">{listing.contact_phone}</dd>
              </div>
            )}
          </dl>
        </section>

        {/* Syllabus */}
        <section className={section}>
          <h3 className={sectionHeading}>Syllabus</h3>
          <p className="mt-2 text-sm">
            <span className="feis-narrow text-[22px] leading-none">{competitionSummary.total}</span>{' '}
            competitions
            {competitionSummary.total > 0 && (
              <span className="text-muted-foreground">
                : {competitionSummary.solos} solos, {competitionSummary.championships}{' '}
                championships, {competitionSummary.specials} specials
              </span>
            )}
          </p>
        </section>

        {/* Fees */}
        <section className={section}>
          <h3 className={sectionHeading}>Fees</h3>
          {feeSchedule ? (
            <dl className="mt-2 text-sm sm:max-w-md">
              {[
                { label: 'Event fee', value: formatCentsOrNull(feeSchedule.event_fee_cents) },
                { label: 'Solo fee', value: formatCentsOrNull(feeSchedule.solo_fee_cents) },
                {
                  label: 'Prelim championship fee',
                  value: formatCentsOrNull(feeSchedule.prelim_champ_fee_cents)
                },
                {
                  label: 'Open championship fee',
                  value: formatCentsOrNull(feeSchedule.open_champ_fee_cents)
                },
                {
                  label: 'Entry max per family',
                  value: formatCentsOrNull(feeSchedule.family_cap_cents, 'No cap')
                },
                {
                  label: 'Day-of surcharge',
                  value: formatCentsOrNull(feeSchedule.day_of_surcharge_cents)
                }
              ].map((row) => (
                <div key={row.label} className="flex items-baseline gap-1.5 py-1">
                  <dt>{row.label}</dt>
                  <span className="feis-leader" aria-hidden="true" />
                  <dd className="font-semibold tabular-nums">{row.value}</dd>
                </div>
              ))}
              <div className="py-1">
                <dt>Late fees</dt>
                <dd className="mt-0.5 text-muted-foreground tabular-nums">
                  {feeSchedule.late_fee_tiers.length === 0
                    ? 'None'
                    : sortLateTiers(feeSchedule.late_fee_tiers).map((tier) => (
                        <span key={tier.starts_at} className="block">
                          {formatLateTier(tier, timeZone)}
                        </span>
                      ))}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No fees set yet.</p>
          )}
        </section>

        {/* Deadlines */}
        <section className={section}>
          <h3 className={sectionHeading}>Deadlines</h3>
          <dl className="mt-2 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Registration opens</dt>
              <dd className="font-semibold">{formatDateTime(listing.reg_opens_at, 'Not set', timeZone)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Registration closes</dt>
              <dd className="font-semibold">{formatDateTime(listing.reg_closes_at, 'Not set', timeZone)}</dd>
            </div>
            {listing.late_reg_closes_at && (
              <div>
                <dt className="text-muted-foreground">Late registration closes</dt>
                <dd className="font-semibold">
                  {formatDateTime(listing.late_reg_closes_at, 'Not set', timeZone)}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground">Dancer cap</dt>
              <dd className="font-semibold">{listing.dancer_cap ?? 'No limit'}</dd>
            </div>
          </dl>
        </section>

        {/* Stripe Connect */}
        <section className={section}>
          <h3 className={sectionHeading}>Payments</h3>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span
              className={`rounded-[2px] px-1.5 py-0.5 text-xs font-bold ${
                stripeSimulated
                  ? 'bg-[var(--color-feis-green-light)] text-[var(--color-feis-green)]'
                  : 'bg-[var(--color-feis-orange-light)] text-[var(--color-feis-orange-ink)]'
              }`}
            >
              {stripeSimulated ? 'Stripe connected' : 'Stripe not connected'}
            </span>
            {!stripeSimulated && (
              <button
                type="button"
                onClick={handleSimulateStripe}
                className="feis-btn feis-btn-ink px-3 py-1.5"
              >
                Connect Stripe account
              </button>
            )}
          </div>
          {!stripeSimulated && (
            <p className="mt-2 text-xs text-muted-foreground">
              Stripe is simulated for now. This button marks the account as connected so you can try
              submitting.
            </p>
          )}
        </section>
      </div>

      {/* Submit checklist */}
      <section className="mt-6">
        <h3 className={`${sectionHeading} mb-3`}>Before you submit</h3>
        <PublishChecklist
          blocks={blocks}
          warnings={warnings}
          passed={passed}
          linkFor={(block) => checklistLinkFor(block, listing.id)}
        />
      </section>

      {/* Navigation */}
      <div className="mt-8 flex flex-wrap items-start gap-3">
        <button type="button" onClick={onBack} className="feis-btn feis-btn-outline">
          Back
        </button>
        <div className="flex flex-col items-start gap-1.5">
          <button
            type="button"
            onClick={handleSubmitForApproval}
            disabled={isPending || blocks.length > 0}
            className="feis-btn feis-btn-primary"
          >
            {isPending
              ? 'Submitting…'
              : blocks.length > 0
                ? "Can't submit yet"
                : 'Submit for approval'}
          </button>
          {blocks.length > 0 && (
            <p className="text-sm font-semibold text-destructive">
              Fix the items above before submitting.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
