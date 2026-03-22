import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { parseLocalDate } from '@/lib/format'
import type { FeisListing } from '@/lib/types/feis-listing'

export const dynamic = 'force-dynamic'

function parseMonth(dateString: string): string {
  const date = parseLocalDate(dateString)
  return date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()
}

function parseDay(dateString: string): string {
  const date = parseLocalDate(dateString)
  return date.getDate().toString()
}

function parseWeekday(dateString: string): string {
  const date = parseLocalDate(dateString)
  return date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()
}

function formatDeadline(dateString: string | null): { text: string; urgent: boolean } {
  if (!dateString) return { text: '', urgent: false }

  const closes = new Date(dateString)
  const now = new Date()

  if (closes < now) {
    return { text: 'Registration closed', urgent: false }
  }

  const daysLeft = Math.ceil((closes.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

  const formatted = closes.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  })

  const time = closes.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

  const timeStr = time === '12:00 AM' ? 'midnight' : time

  if (daysLeft <= 3) {
    return { text: `Closes in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`, urgent: true }
  }

  if (daysLeft <= 7) {
    return { text: `Closes ${formatted}`, urgent: true }
  }

  return {
    text: `Closes ${formatted} at ${timeStr}`,
    urgent: false,
  }
}

function formatLocation(venueName: string | null, venueAddress: string | null): string {
  if (!venueName && !venueAddress) return ''
  if (!venueAddress) return venueName ?? ''
  const parts = venueAddress.split(',').map(s => s.trim())
  if (parts.length >= 2) {
    return `${parts[0]}, ${parts[1]}`
  }
  return venueAddress
}

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export default async function HomePage() {
  const supabase = await createClient()

  const [{ data: { user } }, { data: listings, error }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from('feis_listings').select('*').eq('status', 'open').order('feis_date', { ascending: true }),
  ])

  if (error) {
    console.error('Failed to fetch listings:', error)
  }

  const feiseanna = (listings ?? []) as FeisListing[]

  const now = new Date()
  const openForReg = feiseanna.filter(f =>
    !f.reg_closes_at || new Date(f.reg_closes_at) > now
  )
  const closedReg = feiseanna.filter(f =>
    f.reg_closes_at && new Date(f.reg_closes_at) <= now
  )

  return (
    <div className="min-h-screen bg-[var(--color-feis-cream)]">
      {/* Nav — dark green with gold accent */}
      <nav className="feis-hero-nav">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-white/15">
              <span className="text-sm font-bold text-white">FT</span>
            </div>
            <span className="text-lg font-bold tracking-tight text-white">FeisTab</span>
          </Link>
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <Link
                  href="/dashboard"
                  className="text-sm font-medium text-white/70 transition-colors hover:text-white"
                >
                  My Registrations
                </Link>
                <Link
                  href="/organiser/feiseanna"
                  className="rounded-md bg-white/15 px-4 py-1.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/25"
                >
                  Organiser Portal
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/auth/login"
                  className="text-sm font-medium text-white/70 transition-colors hover:text-white"
                >
                  Sign In
                </Link>
                <Link
                  href="/organiser/feiseanna"
                  className="rounded-md bg-white/15 px-4 py-1.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/25"
                >
                  Organiser Portal
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero */}
      <div className="feis-hero px-6 pb-10 pt-12">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Upcoming Feiseanna
          </h1>
          <p className="mt-2 text-base text-white/60">
            Browse Irish dance competitions and register your dancers.
          </p>
        </div>
      </div>

      {/* Gold divider */}
      <div className="feis-gold-rule" />

      {/* Content */}
      <div className="mx-auto max-w-4xl px-6 py-8">
        {feiseanna.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--color-feis-green)]/20 bg-white px-6 py-20 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-feis-green-light)]">
              <svg className="h-6 w-6 text-[var(--color-feis-green)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
            </div>
            <p className="text-lg font-semibold text-foreground">
              No feiseanna open for registration
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Check back soon — new competitions are posted regularly.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Open for registration */}
            {openForReg.map((feis) => {
              const deadline = feis.reg_closes_at
                ? formatDeadline(feis.reg_closes_at)
                : { text: '', urgent: false }
              const location = formatLocation(feis.venue_name, feis.venue_address)

              return (
                <div
                  key={feis.id}
                  className="feis-listing-card flex gap-4 p-5"
                >
                  {/* Logo + Date badge */}
                  <div className="flex flex-shrink-0 items-start gap-3">
                    {feis.logo_url && (
                      <img
                        src={feis.logo_url}
                        alt=""
                        className="h-12 w-12 rounded-md border border-border object-contain"
                      />
                    )}
                    {feis.feis_date && (
                      <div className="feis-date-badge">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-feis-green)]">
                          {parseMonth(feis.feis_date)}
                        </div>
                        <div className="text-2xl font-bold leading-tight text-foreground">
                          {parseDay(feis.feis_date)}
                        </div>
                        <div className="text-[10px] font-medium text-muted-foreground">
                          {parseWeekday(feis.feis_date)}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/feiseanna/${feis.id}`}
                      className="text-base font-semibold text-foreground decoration-[var(--color-feis-green)]/30 hover:underline"
                    >
                      {feis.name}
                    </Link>
                    {location && (
                      <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                        <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                        </svg>
                        {location}
                      </div>
                    )}
                    {deadline.text && (
                      <div className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        deadline.urgent
                          ? 'feis-urgency bg-[var(--color-feis-orange-light)] text-[var(--color-feis-orange)]'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {deadline.text}
                      </div>
                    )}
                    <div className="mt-3 flex items-center gap-3">
                      <Link
                        href={`/feiseanna/${feis.id}`}
                        className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-feis-green)] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-[var(--color-feis-green-600)] hover:shadow-md"
                      >
                        Details & Register
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
                      </Link>
                      {feis.website_url && (
                        <a
                          href={feis.website_url.startsWith('http') ? feis.website_url : `https://${feis.website_url}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-muted-foreground transition-colors hover:text-[var(--color-feis-green)]"
                        >
                          {extractDomain(feis.website_url)} ↗
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}

            {/* Closed registrations */}
            {closedReg.length > 0 && (
              <>
                <div className="flex items-center gap-3 pt-6">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Registration Closed
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                {closedReg.map((feis) => {
                  const location = formatLocation(feis.venue_name, feis.venue_address)

                  return (
                    <div
                      key={feis.id}
                      className="feis-listing-card-closed flex gap-4 p-5"
                    >
                      {feis.feis_date && (
                        <div className="feis-date-badge flex-shrink-0 opacity-60">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            {parseMonth(feis.feis_date)}
                          </div>
                          <div className="text-2xl font-bold leading-tight text-muted-foreground">
                            {parseDay(feis.feis_date)}
                          </div>
                          <div className="text-[10px] font-medium text-muted-foreground">
                            {parseWeekday(feis.feis_date)}
                          </div>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-base font-semibold text-muted-foreground">
                          {feis.name}
                        </div>
                        {location && (
                          <div className="mt-0.5 text-sm text-muted-foreground">
                            {location}
                          </div>
                        )}
                        <div className="mt-1.5 text-xs text-muted-foreground">
                          Registration closed
                        </div>
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="mt-auto border-t bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-6">
          <div className="text-xs text-muted-foreground">
            FeisTab — Irish dance competition management
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <Link href="/auth/login" className="hover:text-foreground">Sign In</Link>
            <Link href="/organiser/feiseanna" className="hover:text-foreground">Organisers</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
