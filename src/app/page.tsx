import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { FeisListing } from '@/lib/types/feis-listing'

export const dynamic = 'force-dynamic'

function parseMonth(dateString: string): string {
  const date = new Date(dateString + 'T00:00:00')
  return date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()
}

function parseDay(dateString: string): string {
  const date = new Date(dateString + 'T00:00:00')
  return date.getDate().toString()
}

function parseWeekday(dateString: string): string {
  const date = new Date(dateString + 'T00:00:00')
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

  // Show "at midnight" instead of "at 12:00 AM"
  const timeStr = time === '12:00 AM' ? 'midnight' : time

  return {
    text: `Registration closes ${formatted} at ${timeStr}`,
    urgent: daysLeft <= 7,
  }
}

function formatLocation(venueName: string | null, venueAddress: string | null): string {
  if (!venueName && !venueAddress) return ''
  if (!venueAddress) return venueName ?? ''
  // Try to extract city/state from address
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
  const { data: { user } } = await supabase.auth.getUser()

  const { data: listings, error } = await supabase
    .from('feis_listings')
    .select('*')
    .eq('status', 'open')
    .order('feis_date', { ascending: true })

  if (error) {
    console.error('Failed to fetch listings:', error)
  }

  const feiseanna = (listings ?? []) as FeisListing[]

  // Split into open and closed registration
  const now = new Date()
  const openForReg = feiseanna.filter(f =>
    !f.reg_closes_at || new Date(f.reg_closes_at) > now
  )
  const closedReg = feiseanna.filter(f =>
    f.reg_closes_at && new Date(f.reg_closes_at) <= now
  )

  return (
    <div className="min-h-screen bg-[var(--color-feis-cream)]">
      {/* Nav */}
      <nav className="border-b bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
          <Link href="/" className="text-lg font-bold text-primary">
            FeisTab
          </Link>
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <Link
                  href="/dashboard"
                  className="text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  My Registrations
                </Link>
                <Link
                  href="/organiser/feiseanna"
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-[var(--color-feis-green-600)]"
                >
                  Organiser
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/auth/login"
                  className="text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  Sign In
                </Link>
                <Link
                  href="/organiser/feiseanna"
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-[var(--color-feis-green-600)]"
                >
                  Organiser
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Content */}
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="mb-1 text-2xl font-bold">Upcoming Feiseanna</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Find a feis and register your dancers.
        </p>

        {feiseanna.length === 0 ? (
          <div className="feis-card px-6 py-16 text-center">
            <p className="text-lg font-medium text-muted-foreground">
              No feiseanna are currently open for registration.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Check back soon — new events are posted regularly.
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
                  className="feis-card flex gap-4 p-4"
                >
                  {/* Logo + Date block */}
                  <div className="flex flex-shrink-0 items-center gap-3">
                    {feis.logo_url && (
                      <img
                        src={feis.logo_url}
                        alt=""
                        className="h-12 w-12 rounded object-contain"
                      />
                    )}
                    {feis.feis_date && (
                      <div className="flex w-14 flex-col items-center pt-0.5">
                        <span className="text-xs font-semibold uppercase tracking-wide text-primary">
                          {parseMonth(feis.feis_date)}
                        </span>
                        <span className="text-2xl font-bold leading-none text-foreground">
                          {parseDay(feis.feis_date)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {parseWeekday(feis.feis_date)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Divider */}
                  <div className="w-px self-stretch bg-border" />

                  {/* Info */}
                  <div className="flex-1">
                    <div className="text-base font-semibold text-foreground">
                      {feis.name}
                    </div>
                    {location && (
                      <div className="mt-0.5 text-sm text-muted-foreground">
                        {location}
                      </div>
                    )}
                    {deadline.text && (
                      <div className={`mt-1 text-xs font-medium ${
                        deadline.urgent
                          ? 'text-[var(--color-feis-orange)]'
                          : 'text-muted-foreground'
                      }`}>
                        {deadline.text}
                      </div>
                    )}
                    <div className="mt-2 flex items-center gap-3">
                      <Link
                        href={`/feiseanna/${feis.id}`}
                        className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-[var(--color-feis-green-600)]"
                      >
                        Details / Register
                      </Link>
                      {feis.website_url && (
                        <a
                          href={feis.website_url.startsWith('http') ? feis.website_url : `https://${feis.website_url}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-primary underline decoration-primary/30 hover:decoration-primary"
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
                <div className="pt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Registration Closed
                </div>
                {closedReg.map((feis) => {
                  const location = formatLocation(feis.venue_name, feis.venue_address)

                  return (
                    <div
                      key={feis.id}
                      className="feis-card flex gap-4 p-4 opacity-50"
                    >
                      {feis.feis_date && (
                        <div className="flex w-14 flex-shrink-0 flex-col items-center pt-0.5">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {parseMonth(feis.feis_date)}
                          </span>
                          <span className="text-2xl font-bold leading-none text-muted-foreground">
                            {parseDay(feis.feis_date)}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {parseWeekday(feis.feis_date)}
                          </span>
                        </div>
                      )}
                      <div className="w-px self-stretch bg-border" />
                      <div className="flex-1">
                        <div className="text-base font-semibold text-muted-foreground">
                          {feis.name}
                        </div>
                        {location && (
                          <div className="mt-0.5 text-sm text-muted-foreground">
                            {location}
                          </div>
                        )}
                        <div className="mt-1 text-xs text-muted-foreground">
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
    </div>
  )
}
