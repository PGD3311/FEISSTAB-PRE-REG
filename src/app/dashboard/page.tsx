import { createClient, getSignedInUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { addDancesOrderIds, isAddOnOrder } from '@/lib/entry-display'
import { formatDate, formatCents } from '@/lib/format'
import { REGISTRATION_COLUMNS } from '@/lib/registration-columns'
import { isHouseholdComplete } from '@/lib/household'
import {
  openReviewsByOrder,
  reviewMessage,
  type PaymentReview
} from '@/lib/payment-review-messages'
import type {
  Registration,
  Dancer,
  FeisListing,
  RegistrationStatus
} from '@/lib/types/feis-listing'
import { PageTitle } from '@/components/page-title'

export const dynamic = 'force-dynamic'

const STATUS_STYLES: Record<RegistrationStatus, { tag: string; label: string }> = {
  draft: {
    tag: 'bg-[var(--color-feis-orange-light)] text-[var(--color-feis-orange-ink)]',
    label: 'Not paid yet'
  },
  pending_payment: {
    tag: 'bg-[var(--color-feis-orange-light)] text-[var(--color-feis-orange-ink)]',
    label: 'Payment processing'
  },
  paid: {
    tag: 'bg-[var(--color-feis-green-light)] text-[var(--color-feis-green-700)]',
    label: 'Paid'
  },
  expired: {
    tag: 'bg-[var(--color-feis-cream-dark)] text-muted-foreground',
    label: 'Hold ran out'
  },
  cancelled: {
    tag: 'bg-[var(--color-feis-cream-dark)] text-muted-foreground',
    label: 'Cancelled'
  }
}

// An open payment case says more than the order's status: what the family should do next
const REVIEW_STYLES: Record<PaymentReview['message_code'], { tag: string; label: string }> = {
  A: {
    tag: 'bg-[var(--color-feis-orange-light)] text-[var(--color-feis-orange-ink)]',
    label: 'Being checked'
  },
  B: {
    tag: 'bg-[var(--color-feis-orange-light)] text-[var(--color-feis-orange-ink)]',
    label: 'Payment didn’t go through'
  }
}

// The orders My entries lists, besides any with an open payment case
const LISTED_STATUSES: RegistrationStatus[] = ['paid', 'pending_payment', 'draft']

export default async function DashboardPage() {
  const supabase = await createClient()
  const user = await getSignedInUser(supabase)
  if (!user) redirect('/auth/login')

  const { data: household } = await supabase
    .from('households')
    .select('id, first_name, last_name, phone, address_line1, city, state_region, postal_code')
    .eq('user_id', user.id)
    .single()

  if (!household) redirect('/auth/onboarding')
  const detailsComplete = isHouseholdComplete(household)

  // Dancers, registrations and the family's view of any payment cases, in parallel
  const [dancersRead, registrationsRead, reviews] = await Promise.all([
    supabase
      .from('dancers')
      .select('id, first_name, last_name')
      .eq('household_id', household.id)
      .eq('is_active', true)
      .order('first_name'),
    supabase
      .from('registrations')
      .select(
        `
        ${REGISTRATION_COLUMNS},
        feis_listings(name, feis_date, venue_name, status, reg_opens_at, reg_closes_at, late_reg_closes_at),
        registration_entries(dancer_id, feis_competitions(display_name))
      `
      )
      .eq('household_id', household.id)
      .order('created_at', { ascending: false }),
    supabase.rpc('get_my_payment_reviews', { p_registration_id: null })
  ])
  if (dancersRead.error) console.error('Dancers failed to load:', dancersRead.error)
  if (registrationsRead.error) console.error('Entries failed to load:', registrationsRead.error)
  if (reviews.error) console.error('Payment reviews failed to load:', reviews.error)
  // A failed read must not look like "No entries yet": that would hide a paid entry, or the
  // message A that tells the family not to pay again
  const entriesFailed = dancersRead.error !== null || registrationsRead.error !== null
  const reviewRows = (reviews.data ?? []) as PaymentReview[]
  const openReviews = openReviewsByOrder(reviewRows)

  // `unknown` first: the client types a to-one embed (feis_listings) as an array, but each registration has one feis
  const allRegistrations = (registrationsRead.data ?? []) as unknown as (Registration & {
    feis_listings: Pick<
      FeisListing,
      | 'name'
      | 'feis_date'
      | 'venue_name'
      | 'status'
      | 'reg_opens_at'
      | 'reg_closes_at'
      | 'late_reg_closes_at'
    >
    registration_entries: { dancer_id: string; feis_competitions: { display_name: string } }[]
  })[]

  // Which paid orders offer Add dances: the feis's newest paid order, while the feis can take a new
  // order now (spec §14). Nothing is offered if the payment cases couldn't be read
  const addDancesOn = addDancesOrderIds(
    allRegistrations,
    reviewRows,
    reviews.error !== null,
    new Date()
  )

  // Released and expired holds never became entries, so they stay off the list, unless the order
  // has an open payment case: then it shows, so its message A or B reaches the family
  const typedRegistrations = allRegistrations.filter(
    (reg) => LISTED_STATUSES.includes(reg.status) || openReviews.has(reg.id)
  )

  const typedDancers = (dancersRead.data ?? []) as Pick<Dancer, 'id' | 'first_name' | 'last_name'>[]

  const hasRegistrations = !entriesFailed && typedRegistrations.length > 0

  return (
    <div>
      <PageTitle
        title="My entries"
        intro="Every feis your family has entered, with what you paid and your confirmation numbers."
        action={
          hasRegistrations ? (
            <Link href="/" className="feis-btn feis-btn-primary">
              Find a feis to enter
            </Link>
          ) : undefined
        }
      />

      {!detailsComplete && (
        <div className="mb-6 flex max-w-3xl flex-wrap items-center justify-between gap-3 border-l-4 border-[var(--color-feis-orange)] bg-[var(--color-feis-orange-light)] px-4 py-2.5 text-sm text-[var(--color-feis-orange-ink)]">
          <span>Add your name, phone and address before you enter a feis.</span>
          <Link href="/dashboard/account" className="feis-link">
            Add family details
          </Link>
        </div>
      )}

      {reviews.error && !entriesFailed && (
        <p
          role="status"
          className="mb-6 max-w-3xl border-l-4 border-[var(--color-feis-orange)] bg-[var(--color-feis-orange-light)] px-4 py-2.5 text-sm text-[var(--color-feis-orange-ink)]"
        >
          We couldn&apos;t check for messages about your payments just now. Refresh the page to
          try again.
        </p>
      )}

      {typedDancers.length > 0 && hasRegistrations && (
        <p className="mb-4 text-sm text-muted-foreground">
          Your dancers:{' '}
          <span className="font-semibold text-foreground">
            {typedDancers.map((d) => d.first_name).join(', ')}
          </span>
          .{' '}
          <Link href="/dashboard/dancers" className="feis-link">
            Manage dancers
          </Link>
        </p>
      )}

      {entriesFailed ? (
        <p
          role="status"
          className="mb-6 max-w-3xl border-l-4 border-[var(--color-feis-orange)] bg-[var(--color-feis-orange-light)] px-4 py-2.5 text-sm text-[var(--color-feis-orange-ink)]"
        >
          We couldn&apos;t load your entries. Please refresh.
        </p>
      ) : !hasRegistrations ? (
        <div className="feis-sticker max-w-3xl rounded px-5 py-5">
          <p className="font-bold">No entries yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a feis that&apos;s taking entries, choose dances for your dancers and pay once for
            the family.
          </p>
          <Link href="/" className="feis-btn feis-btn-ink mt-4">
            Find a feis to enter
          </Link>
        </div>
      ) : (
        <ul className="border-b-[1.5px] border-[var(--color-feis-charcoal)]">
          {typedRegistrations.map((reg) => {
            const review = openReviews.get(reg.id)
            const status = review ? REVIEW_STYLES[review.message_code] : STATUS_STYLES[reg.status]
            // Message A says not to pay again, so nothing offers another payment beside it
            const canPayAgain = review?.message_code !== 'A'
            // Each receipt names its own order: a family can have several for one feis
            const receiptHref = `/feiseanna/${reg.feis_listing_id}/register/success?order=${reg.id}`
            const dancerIds = [...new Set(reg.registration_entries.map((e) => e.dancer_id))]
            const dancerNames = dancerIds
              .map((id) => typedDancers.find((d) => d.id === id))
              .filter(Boolean)
              .map((d) => d!.first_name)
            const entryCount = reg.registration_entries.length

            return (
              <li
                key={reg.id}
                className="grid gap-x-6 gap-y-3 border-t-[1.5px] border-[var(--color-feis-charcoal)] py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h2 className="text-[22px] leading-tight font-extrabold [font-stretch:75%]">
                      {reg.feis_listings.name}
                    </h2>
                    <span className={`rounded-[2px] px-1.5 py-0.5 text-xs font-bold ${status.tag}`}>
                      {status.label}
                    </span>
                    {isAddOnOrder(reg) && (
                      <span className="rounded-[2px] border border-[var(--color-feis-charcoal)] px-1.5 py-0.5 text-xs font-bold">
                        Added
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {formatDate(reg.feis_listings.feis_date, { month: 'short' })}
                    {reg.feis_listings.venue_name ? `, ${reg.feis_listings.venue_name}` : ''}
                  </p>
                  <p className="mt-1 text-sm">
                    {dancerNames.length > 0 && <>{dancerNames.join(', ')}: </>}
                    {entryCount} competition{entryCount !== 1 ? 's' : ''}
                  </p>
                  {reg.confirmation_number && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Confirmation{' '}
                      <span className="feis-narrow text-lg text-foreground">
                        {reg.confirmation_number}
                      </span>
                    </p>
                  )}
                  {review && (
                    <p
                      role="status"
                      className="mt-2 max-w-[62ch] border-l-4 border-[var(--color-feis-orange)] bg-[var(--color-feis-orange-light)] px-3 py-2 text-sm text-[var(--color-feis-orange-ink)]"
                    >
                      {reviewMessage(review.message_code, review.support_ref)}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 sm:justify-end">
                  {reg.status === 'paid' && (
                    <span className="text-[28px] leading-none font-black tabular-nums [font-stretch:65%]">
                      {formatCents(reg.total_cents)}
                    </span>
                  )}
                  {reg.status === 'paid' && (
                    <Link href={receiptHref} className="feis-btn feis-btn-outline">
                      See receipt
                    </Link>
                  )}
                  {addDancesOn.has(reg.id) && (
                    <Link
                      href={`/feiseanna/${reg.feis_listing_id}/register`}
                      className="feis-btn feis-btn-outline"
                    >
                      Add dances
                    </Link>
                  )}
                  {(reg.status === 'draft' || reg.status === 'pending_payment') && canPayAgain && (
                    <Link
                      href={`/feiseanna/${reg.feis_listing_id}/register`}
                      className="feis-btn feis-btn-primary"
                    >
                      {reg.total_cents === 0 ? 'Finish and confirm' : 'Finish and pay'}
                    </Link>
                  )}
                  {reg.status === 'expired' && canPayAgain && (
                    <Link
                      href={`/feiseanna/${reg.feis_listing_id}/register`}
                      className="feis-btn feis-btn-ink"
                    >
                      Enter again
                    </Link>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
