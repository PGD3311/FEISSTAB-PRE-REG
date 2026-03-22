import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { formatDate, formatDateTime, formatCents } from '@/lib/format'
import type { FeisListing, FeeSchedule, FeisCompetition, CompetitionType } from '@/lib/types/feis-listing'

export const dynamic = 'force-dynamic'

function groupByType(
  competitions: FeisCompetition[]
): Record<CompetitionType, FeisCompetition[]> {
  const groups: Record<CompetitionType, FeisCompetition[]> = {
    solo: [],
    championship: [],
    special: [],
    custom: [],
  }
  for (const comp of competitions) {
    groups[comp.competition_type].push(comp)
  }
  return groups
}

interface PageParams {
  params: Promise<{ id: string }>
}

export default async function FeisDetailPage({ params }: PageParams) {
  const { id } = await params
  const supabase = await createClient()

  // Fetch user (optional — page is public) and listing in parallel
  const [{ data: { user } }, { data: listingData, error: listingError }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from('feis_listings').select('*').eq('id', id).eq('status', 'open').single(),
  ])

  if (listingError || !listingData) {
    notFound()
  }

  const listing = listingData as FeisListing

  // Fetch fee schedule and competitions in parallel
  const [feeResult, compsResult] = await Promise.all([
    supabase
      .from('fee_schedules')
      .select('*')
      .eq('feis_listing_id', id)
      .single(),
    supabase
      .from('feis_competitions')
      .select('*')
      .eq('feis_listing_id', id)
      .eq('enabled', true)
      .order('display_name', { ascending: true }),
  ])

  const feeSchedule = feeResult.data as FeeSchedule | null
  const competitions = (compsResult.data ?? []) as FeisCompetition[]
  const grouped = groupByType(competitions)

  const TYPE_LABELS: Record<CompetitionType, string> = {
    solo: 'Solo Competitions',
    championship: 'Championships',
    special: 'Special Competitions',
    custom: 'Other Competitions',
  }

  return (
    <div className="min-h-screen bg-[var(--color-feis-cream)]">
      <div className="mx-auto max-w-4xl px-6 py-8">
        {/* Back link */}
        <Link
          href="/feiseanna"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          All Feiseanna
        </Link>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold">{listing.name}</h1>
          <p className="mt-2 text-lg text-muted-foreground">
            {formatDate(listing.feis_date, { weekday: 'long', fallback: '—' })}
          </p>
          {listing.venue_name && (
            <p className="mt-1 text-muted-foreground">
              {listing.venue_name}
              {listing.venue_address ? ` — ${listing.venue_address}` : ''}
            </p>
          )}
        </div>

        <div className="space-y-6">
          {/* Description */}
          {listing.description && (
            <div className="feis-card p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                About This Feis
              </h2>
              <p className="whitespace-pre-line text-sm leading-relaxed">{listing.description}</p>
            </div>
          )}

          {/* Registration Timeline */}
          <div className="feis-card p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Registration Timeline
            </h2>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Registration Opens</dt>
                <dd className="mt-0.5 text-sm font-medium">{formatDateTime(listing.reg_opens_at, '—')}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Registration Closes</dt>
                <dd className="mt-0.5 text-sm font-medium">{formatDateTime(listing.reg_closes_at, '—')}</dd>
              </div>
              {listing.late_reg_closes_at && (
                <div>
                  <dt className="text-xs text-muted-foreground">Late Registration Closes</dt>
                  <dd className="mt-0.5 text-sm font-medium">{formatDateTime(listing.late_reg_closes_at, '—')}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Fee Schedule */}
          {feeSchedule && (
            <div className="feis-card p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Fees
              </h2>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  <tr>
                    <td className="py-2 text-muted-foreground">Event Fee (per family)</td>
                    <td className="py-2 text-right font-medium">{formatCents(feeSchedule.event_fee_cents)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 text-muted-foreground">Solo Dance (per dancer)</td>
                    <td className="py-2 text-right font-medium">{formatCents(feeSchedule.solo_fee_cents)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 text-muted-foreground">Prelim Championship</td>
                    <td className="py-2 text-right font-medium">
                      {formatCents(feeSchedule.prelim_champ_fee_cents)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 text-muted-foreground">Open Championship</td>
                    <td className="py-2 text-right font-medium">
                      {formatCents(feeSchedule.open_champ_fee_cents)}
                    </td>
                  </tr>
                  {feeSchedule.family_cap_cents !== null && (
                    <tr>
                      <td className="py-2 text-muted-foreground">Family Cap</td>
                      <td className="py-2 text-right font-medium">
                        {formatCents(feeSchedule.family_cap_cents)}
                      </td>
                    </tr>
                  )}
                  {feeSchedule.late_fee_cents > 0 && (
                    <tr>
                      <td className="py-2 text-muted-foreground">Late Fee (per dancer)</td>
                      <td className="py-2 text-right font-medium text-[var(--color-feis-orange)]">
                        +{formatCents(feeSchedule.late_fee_cents)}
                      </td>
                    </tr>
                  )}
                  {feeSchedule.day_of_surcharge_cents > 0 && (
                    <tr>
                      <td className="py-2 text-muted-foreground">Day-of Surcharge</td>
                      <td className="py-2 text-right font-medium text-[var(--color-feis-orange)]">
                        +{formatCents(feeSchedule.day_of_surcharge_cents)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Competition List */}
          {competitions.length > 0 && (
            <div className="feis-card p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Competitions ({competitions.length} total)
              </h2>
              <div className="space-y-5">
                {(Object.entries(grouped) as [CompetitionType, FeisCompetition[]][])
                  .filter(([, comps]) => comps.length > 0)
                  .map(([type, comps]) => (
                    <div key={type}>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {TYPE_LABELS[type]} ({comps.length})
                      </h3>
                      <ul className="space-y-1">
                        {comps.map((comp) => (
                          <li key={comp.id} className="text-sm text-foreground">
                            {comp.display_name}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Contact */}
          {listing.show_contact_publicly && (listing.contact_email || listing.contact_phone) && (
            <div className="feis-card p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Contact
              </h2>
              <dl className="space-y-1 text-sm">
                {listing.contact_email && (
                  <div>
                    <dt className="inline text-muted-foreground">Email: </dt>
                    <dd className="inline">
                      <a
                        href={`mailto:${listing.contact_email}`}
                        className="text-primary hover:underline"
                      >
                        {listing.contact_email}
                      </a>
                    </dd>
                  </div>
                )}
                {listing.contact_phone && (
                  <div>
                    <dt className="inline text-muted-foreground">Phone: </dt>
                    <dd className="inline">{listing.contact_phone}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {/* Register CTA */}
          <div className="rounded-lg border border-[var(--color-feis-green-light)] bg-[var(--color-feis-green-light)] p-6 text-center">
            {user ? (
              <>
                <p className="mb-4 text-sm text-muted-foreground">
                  Ready to register your dancer(s) for this feis?
                </p>
                <Link
                  href={`/feiseanna/${listing.id}/register`}
                  className="inline-block rounded-md bg-primary px-8 py-3 font-medium text-primary-foreground transition-colors hover:bg-[var(--color-feis-green-600)]"
                >
                  Register Now
                </Link>
              </>
            ) : (
              <>
                <p className="mb-4 text-sm text-muted-foreground">
                  Sign in to register your dancer(s) for this feis.
                </p>
                <Link
                  href={`/auth/login?redirect=/feiseanna/${listing.id}/register`}
                  className="inline-block rounded-md bg-primary px-8 py-3 font-medium text-primary-foreground transition-colors hover:bg-[var(--color-feis-green-600)]"
                >
                  Sign In to Register
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
