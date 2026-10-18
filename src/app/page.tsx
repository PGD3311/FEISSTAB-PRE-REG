import Link from 'next/link'
import { createClient, getSignedInUser } from '@/lib/supabase/server'
import { parseLocalDate, siteName, websiteHref } from '@/lib/format'
import { entryDeadline, formatDeadline } from '@/lib/entry-display'
import { CoverBand, type CoverLink } from '@/components/feis-cover'
import type { FeisListing } from '@/lib/types/feis-listing'

export const dynamic = 'force-dynamic'

const DAY_MS = 24 * 60 * 60 * 1000

function formatPlace(venueName: string | null, venueAddress: string | null): string {
  if (!venueAddress) return venueName ?? ''
  const parts = venueAddress.split(',').map((s) => s.trim())
  const town =
    parts.length >= 2 ? `${parts[parts.length - 2]}, ${parts[parts.length - 1]}` : venueAddress
  return venueName ? `${venueName}, ${town}` : town
}

type FeisRowListing = Pick<
  FeisListing,
  | 'id'
  | 'name'
  | 'feis_date'
  | 'venue_name'
  | 'venue_address'
  | 'timezone'
  | 'reg_closes_at'
  | 'late_reg_closes_at'
  | 'logo_url'
  | 'website_url'
>

function FeisRow({ feis, now }: { feis: FeisRowListing; now: Date }) {
  const deadline = entryDeadline(feis, now)
  const timeZone = feis.timezone ?? 'America/New_York'
  const date = feis.feis_date ? parseLocalDate(feis.feis_date) : null
  const daysLeft = deadline.closesAt
    ? Math.ceil((new Date(deadline.closesAt).getTime() - now.getTime()) / DAY_MS)
    : null
  const closingSoon = !deadline.closed && daysLeft !== null && daysLeft <= 7
  const place = formatPlace(feis.venue_name, feis.venue_address)

  return (
    <li className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-5 gap-y-3 border-t-[1.5px] border-[var(--color-feis-charcoal)] py-5 sm:grid-cols-[72px_minmax(0,1fr)_auto] sm:items-center">
      <div className="text-center leading-none">
        {date ? (
          <>
            <div className="feis-narrow text-[44px] leading-[0.9]">{date.getDate()}</div>
            <div className="mt-1 text-[13px] font-bold">
              {date.toLocaleDateString('en-GB', { month: 'short' })}
            </div>
            <div className="text-[12px] text-muted-foreground">
              {date.toLocaleDateString('en-GB', { weekday: 'short' })}
            </div>
          </>
        ) : (
          <div className="text-[13px] text-muted-foreground">Date to come</div>
        )}
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-3">
          {feis.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element -- organiser logos come from any host
            <img
              src={feis.logo_url}
              alt=""
              className="h-9 w-9 shrink-0 rounded-sm object-contain"
            />
          )}
          <Link
            href={`/feiseanna/${feis.id}`}
            className="text-[22px] leading-tight font-extrabold [font-stretch:75%] hover:underline"
          >
            {feis.name}
          </Link>
        </div>
        {place && <p className="mt-0.5 text-sm text-muted-foreground">{place}</p>}
        {deadline.closesAt && (
          <p
            className={`mt-1 text-sm font-semibold ${
              deadline.closed
                ? 'text-muted-foreground'
                : closingSoon
                  ? 'text-[var(--color-feis-orange-ink)]'
                  : 'text-foreground'
            }`}
          >
            {deadline.closed
              ? 'Entries closed'
              : closingSoon && daysLeft !== null && daysLeft <= 1
                ? `Entries close today, ${formatDeadline(deadline.closesAt, timeZone)}`
                : closingSoon
                  ? `Entries close in ${daysLeft} days, ${formatDeadline(deadline.closesAt, timeZone)}`
                  : `Entries close ${formatDeadline(deadline.closesAt, timeZone)}`}
          </p>
        )}
        {feis.website_url && (
          <a
            href={websiteHref(feis.website_url)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {siteName(feis.website_url)}
          </a>
        )}
      </div>

      <Link
        href={`/feiseanna/${feis.id}`}
        className={`col-start-2 justify-self-start rounded-[3px] px-4 py-2 text-sm font-bold sm:col-start-3 sm:justify-self-end ${
          deadline.closed
            ? 'border-[1.5px] border-[var(--color-feis-charcoal)] text-foreground hover:bg-white'
            : 'bg-[var(--color-feis-charcoal)] text-white hover:bg-black'
        }`}
      >
        {deadline.closed ? 'See details' : 'Details and entry'}
      </Link>
    </li>
  )
}

export default async function HomePage() {
  const supabase = await createClient()

  const [user, { data: listings, error }] = await Promise.all([
    getSignedInUser(supabase),
    supabase
      .from('feis_listings')
      .select(
        'id, name, feis_date, venue_name, venue_address, timezone, reg_closes_at, late_reg_closes_at, logo_url, website_url'
      )
      .eq('status', 'open')
      .order('feis_date', { ascending: true })
  ])

  if (error) {
    console.error('Failed to fetch listings:', error)
  }

  const now = new Date()
  const feiseanna = (listings ?? []) as FeisRowListing[]
  const open = feiseanna.filter((f) => !entryDeadline(f, now).closed)
  const closed = feiseanna.filter((f) => entryDeadline(f, now).closed)

  const links: CoverLink[] = user
    ? [
        { href: '/dashboard', label: 'My entries' },
        { href: '/dashboard/dancers', label: 'My dancers' },
        { href: '/organiser/feiseanna', label: 'Organisers' }
      ]
    : [
        { href: '/auth/login', label: 'Sign in' },
        { href: '/organiser/feiseanna', label: 'Organisers' }
      ]

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-feis-cream)]">
      <CoverBand links={links} signOut={!!user}>
        <div className="min-w-0 pt-3">
          <h1 className="feis-cover-title text-[clamp(34px,6vw,56px)]">Upcoming feiseanna</h1>
          <p className="mt-1.5 max-w-[52ch] opacity-85">
            Enter all your dancers in one go, pay once for the family, and get competitor numbers as
            soon as you&apos;ve paid.
          </p>
        </div>
        {!user && (
          <div className="text-sm md:max-w-[240px] md:text-right">
            <strong className="block text-[22px] leading-tight font-extrabold text-[#E9C77F] [font-stretch:75%]">
              New family?
            </strong>
            <span className="opacity-85">
              Set up your dancers once and use them for every feis.
            </span>
            <Link
              href="/auth/signup"
              className="mt-2 block w-fit rounded-[3px] bg-[#E9C77F] px-3.5 py-2 font-extrabold text-[var(--color-feis-charcoal)] md:ml-auto"
            >
              Create a family account
            </Link>
          </div>
        )}
      </CoverBand>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-7 sm:px-7">
        {feiseanna.length === 0 ? (
          <div className="feis-sticker max-w-xl rounded px-5 py-5">
            <p className="font-bold">No feiseanna are taking entries right now</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Feiseanna appear here as soon as their organisers open entries. Check back closer to
              the season.
            </p>
          </div>
        ) : (
          <div className="grid gap-10">
            {open.length > 0 && (
              <section>
                <h2 className="mb-2 text-[22px] font-extrabold [font-stretch:75%]">
                  Open for entries
                </h2>
                <ul className="border-b-[1.5px] border-[var(--color-feis-charcoal)]">
                  {open.map((feis) => (
                    <FeisRow key={feis.id} feis={feis} now={now} />
                  ))}
                </ul>
              </section>
            )}
            {closed.length > 0 && (
              <section>
                <h2 className="mb-2 text-[22px] font-extrabold text-muted-foreground [font-stretch:75%]">
                  Entries closed
                </h2>
                <ul className="border-b-[1.5px] border-[var(--color-feis-charcoal)] opacity-80">
                  {closed.map((feis) => (
                    <FeisRow key={feis.id} feis={feis} now={now} />
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </main>

      <footer className="border-t-[1.5px] border-[var(--color-feis-charcoal)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-[13px] text-muted-foreground sm:px-7">
          <span>RunFeis runs Irish dance feiseanna, from entries to results.</span>
          <span className="flex gap-4">
            {!user && (
              <Link href="/auth/login" className="hover:text-foreground">
                Sign in
              </Link>
            )}
            <Link href="/organiser/feiseanna" className="hover:text-foreground">
              For organisers
            </Link>
          </span>
        </div>
      </footer>
    </div>
  )
}
