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

export default async function BrowseFeiseannaPage() {
  const supabase = await createClient()

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
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="mb-6 text-2xl font-bold">Open Feiseanna</h1>

        {feiseanna.length === 0 ? (
          <div className="feis-card px-6 py-12 text-center text-muted-foreground">
            No feiseanna are currently open for registration.
          </div>
        ) : (
          <div className="space-y-4">
            {feiseanna.map((feis) => {
              const closeDays = feis.reg_closes_at
                ? daysUntil(feis.reg_closes_at.split('T')[0])
                : null

              return (
                <Link
                  key={feis.id}
                  href={`/feiseanna/${feis.id}`}
                  className="feis-card block p-5 transition-shadow hover:shadow-md"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-lg font-semibold">{feis.name}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatDate(feis.feis_date)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {feis.venue_name}
                        {feis.venue_address ? ` — ${feis.venue_address}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      {closeDays !== null && closeDays <= 7 && closeDays > 0 && (
                        <span className="inline-block rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700">
                          Closes in {closeDays} day{closeDays !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
