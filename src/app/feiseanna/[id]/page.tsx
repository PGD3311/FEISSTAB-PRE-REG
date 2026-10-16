import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient, getSignedInUser } from '@/lib/supabase/server'
import { competitionFeeCents, getActiveLateTier } from '@/lib/engine/fee-calculator'
import { formatCents, sortLateTiers } from '@/lib/format'
import { entryDeadline, groupForEntryForm } from '@/lib/entry-display'
import { FeisCover } from '@/components/feis-cover'
import type {
  FeeSchedule,
  FeisCompetition,
  FeisListing,
  LateFeeTier
} from '@/lib/types/feis-listing'

export const dynamic = 'force-dynamic'

interface PageParams {
  params: Promise<{ id: string }>
}

function PriceLine({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="py-1">
      <div className="flex items-baseline gap-1.5 text-sm">
        <span>{label}</span>
        <span className="feis-leader" />
        <span className="tabular-nums">{value}</span>
      </div>
      {note && <p className="text-[12.5px] text-muted-foreground">{note}</p>}
    </div>
  )
}

function tierStart(tier: LateFeeTier, timeZone: string): string {
  return new Date(tier.starts_at).toLocaleDateString('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short'
  })
}

function competitionName(comp: FeisCompetition): string {
  return comp.competition_type === 'solo' && comp.dance_label ? comp.dance_label : comp.display_name
}

export default async function FeisDetailPage({ params }: PageParams) {
  const { id } = await params
  const supabase = await createClient()

  const [user, { data: listingData, error: listingError }] = await Promise.all([
    getSignedInUser(supabase),
    supabase.from('feis_listings').select('*').eq('id', id).eq('status', 'open').single()
  ])

  if (listingError || !listingData) {
    notFound()
  }

  const listing = listingData as FeisListing
  const timeZone = listing.timezone ?? 'America/New_York'

  const [feeResult, compsResult] = await Promise.all([
    supabase.from('fee_schedules').select('*').eq('feis_listing_id', id).single(),
    supabase
      .from('feis_competitions')
      .select('*')
      .eq('feis_listing_id', id)
      .eq('enabled', true)
      .order('sort_order', { ascending: true })
  ])

  if (compsResult.error) {
    console.error('Failed to load competitions:', compsResult.error)
  }

  const feeSchedule = feeResult.data as FeeSchedule | null
  const competitions = (compsResult.data ?? []) as FeisCompetition[]
  const groups = groupForEntryForm(
    competitions.map((competition) => ({
      competition,
      eligible: true,
      reason: ''
    }))
  )
  const deadline = entryDeadline(listing)
  const activeTier = feeSchedule ? getActiveLateTier(feeSchedule.late_fee_tiers, new Date()) : null
  const enterHref = `/feiseanna/${listing.id}/register`

  return (
    <div className="min-h-screen bg-[var(--color-feis-cream)]">
      <FeisCover
        listing={{
          name: listing.name,
          feis_date: listing.feis_date,
          venue_name: listing.venue_name,
          timezone: listing.timezone,
          reg_closes_at: listing.reg_closes_at,
          late_reg_closes_at: listing.late_reg_closes_at
        }}
        lateFeeCents={deadline.closed ? null : (activeTier?.fee_cents ?? null)}
        links={[
          { href: '/', label: 'All feiseanna' },
          ...(user ? [{ href: '/dashboard', label: 'My entries' }] : [])
        ]}
        signOut={!!user}
      />

      <main className="mx-auto grid max-w-6xl items-start gap-7 px-4 py-7 sm:px-7 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid min-w-0 gap-7">
          {listing.description && (
            <section>
              <h2 className="mb-2 text-[22px] font-extrabold [font-stretch:75%]">
                About this feis
              </h2>
              <p className="max-w-[65ch] text-[15px] leading-relaxed whitespace-pre-line">
                {listing.description}
              </p>
            </section>
          )}

          <section>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[22px] font-extrabold [font-stretch:75%]">Competitions</h2>
              <span className="text-sm text-muted-foreground">
                {competitions.length} in the syllabus. When you enter, each dancer sees only the
                ones they can dance.
              </span>
            </div>

            {competitions.length === 0 ? (
              <p className="feis-sticker rounded px-4 py-3 text-sm">
                The organiser hasn&apos;t published the competitions yet.
              </p>
            ) : (
              <div className="feis-entry-form">
                {groups.map((group, i) => (
                  <section key={group.label}>
                    <h3
                      className={`px-4 pt-2 pb-1 text-[12.5px] font-bold text-muted-foreground ${
                        i > 0 ? 'border-t-[1.5px] border-[var(--color-feis-charcoal)]' : ''
                      }`}
                    >
                      {group.label}
                    </h3>
                    <ul>
                      {group.items.map(({ competition }) => (
                        <li
                          key={competition.id}
                          className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-[#E2DCCD] px-4 py-2 sm:grid-cols-[64px_minmax(0,1fr)_auto]"
                        >
                          <span className="feis-narrow text-[17px]">
                            {competition.display_code ?? ''}
                          </span>
                          <span className="min-w-0">{competitionName(competition)}</span>
                          {feeSchedule && (
                            <span className="text-muted-foreground tabular-nums">
                              {formatCents(competitionFeeCents(competition, feeSchedule))}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="grid gap-7 lg:sticky lg:top-6">
          <div className="feis-receipt px-[18px] pt-5 pb-[18px]">
            {deadline.closed ? (
              <>
                <h2 className="text-[22px] font-extrabold [font-stretch:75%]">
                  Entries are closed
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  This feis isn&apos;t taking entries any more. Families who entered can see their
                  numbers and dances by signing in.
                </p>
                {user && (
                  <Link
                    href={enterHref}
                    className="mt-3 inline-block text-sm font-bold text-primary underline underline-offset-[3px]"
                  >
                    See your entries
                  </Link>
                )}
              </>
            ) : (
              <>
                <h2 className="text-[22px] font-extrabold [font-stretch:75%]">
                  Enter your dancers
                </h2>
                <p className="mt-1 mb-4 text-sm text-muted-foreground">
                  Pick dances for each child, see the family total and pay by card.
                </p>
                {user ? (
                  <Link
                    href={enterHref}
                    className="block w-full rounded-[3px] bg-primary py-3 text-center text-[17px] font-extrabold text-primary-foreground [font-stretch:85%] hover:bg-[var(--color-feis-green-600)]"
                  >
                    Enter dancers
                  </Link>
                ) : (
                  <>
                    <Link
                      href={`/auth/login?redirect=${encodeURIComponent(enterHref)}`}
                      className="block w-full rounded-[3px] bg-primary py-3 text-center text-[17px] font-extrabold text-primary-foreground [font-stretch:85%] hover:bg-[var(--color-feis-green-600)]"
                    >
                      Sign in to enter
                    </Link>
                    <p className="mt-3 text-sm text-muted-foreground">
                      New here?{' '}
                      <Link
                        href={`/auth/signup?redirect=${encodeURIComponent(enterHref)}`}
                        className="font-semibold text-primary underline"
                      >
                        Create a family account
                      </Link>
                    </p>
                  </>
                )}
              </>
            )}
          </div>

          {feeSchedule && (
            <section className="feis-receipt px-[18px] pt-5 pb-[18px]">
              <h2 className="mb-2 text-[22px] font-extrabold [font-stretch:75%]">Fees</h2>
              {feeSchedule.event_fee_cents > 0 && (
                <PriceLine label="Family fee" value={formatCents(feeSchedule.event_fee_cents)} />
              )}
              <PriceLine label="Each solo dance" value={formatCents(feeSchedule.solo_fee_cents)} />
              {competitions.some((c) => c.fee_category === 'prelim_champ') && (
                <PriceLine
                  label="Preliminary championship"
                  value={formatCents(feeSchedule.prelim_champ_fee_cents)}
                />
              )}
              {competitions.some((c) => c.fee_category === 'open_champ') && (
                <PriceLine
                  label="Open championship"
                  value={formatCents(feeSchedule.open_champ_fee_cents)}
                />
              )}
              {feeSchedule.family_cap_cents !== null && (
                <PriceLine
                  label="Most a family pays for entries"
                  value={formatCents(feeSchedule.family_cap_cents)}
                  note="The family fee and late fees are on top of this."
                />
              )}
              {sortLateTiers(feeSchedule.late_fee_tiers).map((tier) => {
                const appliesNow = !deadline.closed && tier.starts_at === activeTier?.starts_at
                const notes = [
                  'Per dancer',
                  tier.family_max_cents === null
                    ? null
                    : `no more than ${formatCents(tier.family_max_cents)} a family`,
                  appliesNow ? 'applies now' : null
                ].filter(Boolean)
                return (
                  <PriceLine
                    key={tier.starts_at}
                    label={`Late fee from ${tierStart(tier, timeZone)}`}
                    value={formatCents(tier.fee_cents)}
                    note={`${notes.join(', ')}.`}
                  />
                )
              })}
              {feeSchedule.day_of_surcharge_cents > 0 && (
                <PriceLine
                  label="Entering on the day"
                  value={`+${formatCents(feeSchedule.day_of_surcharge_cents)}`}
                  note="Per dancer."
                />
              )}
            </section>
          )}

          {listing.show_contact_publicly && (listing.contact_email || listing.contact_phone) && (
            <section className="text-sm">
              <h2 className="mb-1 text-base font-extrabold [font-stretch:80%]">Questions</h2>
              <p className="text-muted-foreground">Contact the organiser:</p>
              {listing.contact_email && (
                <p>
                  <a
                    href={`mailto:${listing.contact_email}`}
                    className="font-semibold text-primary underline"
                  >
                    {listing.contact_email}
                  </a>
                </p>
              )}
              {listing.contact_phone && <p className="select-all">{listing.contact_phone}</p>}
            </section>
          )}
        </aside>
      </main>
    </div>
  )
}
