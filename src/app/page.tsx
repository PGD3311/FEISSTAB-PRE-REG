import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { FeisListing } from '@/lib/types/feis-listing'

export const dynamic = 'force-dynamic'

function formatDate(dateString: string | null): string {
  if (!dateString) return ''
  const date = new Date(dateString + 'T00:00:00')
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function daysUntil(dateString: string): number {
  const target = new Date(dateString + 'T00:00:00')
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
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

  return (
    <div className="min-h-screen bg-[var(--color-feis-cream)]">
      {/* Top nav */}
      <nav className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
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

      {/* Feis listings */}
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="mb-2 text-2xl font-bold">Upcoming Feiseanna</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Browse open Irish dance competitions and register your dancers.
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
          <div className="space-y-4">
            {feiseanna.map((feis) => {
              const closeDays = feis.reg_closes_at
                ? daysUntil(feis.reg_closes_at.split('T')[0])
                : null

              return (
                <div
                  key={feis.id}
                  className="feis-card flex items-center justify-between p-5"
                >
                  <Link href={`/feiseanna/${feis.id}`} className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold hover:text-primary">
                      {feis.name}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatDate(feis.feis_date)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {feis.venue_name}
                      {feis.venue_address ? ` — ${feis.venue_address}` : ''}
                    </p>
                    {closeDays !== null && closeDays <= 7 && closeDays > 0 && (
                      <span className="mt-2 inline-block rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700">
                        Closes in {closeDays} day{closeDays !== 1 ? 's' : ''}
                      </span>
                    )}
                  </Link>
                  <div className="ml-4 shrink-0">
                    <Link
                      href={`/feiseanna/${feis.id}/register`}
                      className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-[var(--color-feis-green-600)]"
                    >
                      Register
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
