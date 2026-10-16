import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { formatDate, formatCents } from '@/lib/format'
import { isHouseholdComplete } from '@/lib/household'
import type { Registration, Dancer, RegistrationStatus } from '@/lib/types/feis-listing'
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

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: household } = await supabase
    .from('households')
    .select('id, first_name, last_name, phone, address_line1, city, state_region, postal_code')
    .eq('user_id', user.id)
    .single()

  if (!household) redirect('/auth/onboarding')
  const detailsComplete = isHouseholdComplete(household)

  // Get dancers and registrations in parallel (both use household.id)
  const [{ data: dancers }, { data: registrations }] = await Promise.all([
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
        *,
        feis_listings(name, feis_date, venue_name),
        registration_entries(dancer_id, feis_competitions(display_name))
      `
      )
      .eq('household_id', household.id)
      .order('created_at', { ascending: false })
  ])

  const typedRegistrations = (registrations ?? []) as (Registration & {
    feis_listings: { name: string; feis_date: string; venue_name: string }
    registration_entries: { dancer_id: string; feis_competitions: { display_name: string } }[]
  })[]

  const typedDancers = (dancers ?? []) as Pick<Dancer, 'id' | 'first_name' | 'last_name'>[]

  const hasRegistrations = typedRegistrations.length > 0

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

      {!hasRegistrations ? (
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
            const status = STATUS_STYLES[reg.status]
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
                </div>

                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 sm:justify-end">
                  {reg.status === 'paid' && (
                    <span className="text-[28px] leading-none font-black tabular-nums [font-stretch:65%]">
                      {formatCents(reg.total_cents)}
                    </span>
                  )}
                  {reg.status === 'paid' && (
                    <Link
                      href={`/feiseanna/${reg.feis_listing_id}/register/success?session_id=${reg.stripe_checkout_session_id}`}
                      className="feis-btn feis-btn-outline"
                    >
                      See receipt
                    </Link>
                  )}
                  {reg.status === 'draft' && (
                    <Link
                      href={`/feiseanna/${reg.feis_listing_id}/register?step=3`}
                      className="feis-btn feis-btn-primary"
                    >
                      Finish and pay
                    </Link>
                  )}
                  {reg.status === 'expired' && (
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
