import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { formatDate, formatCents } from '@/lib/format'
import type { Registration, Dancer, RegistrationStatus } from '@/lib/types/feis-listing'

export const dynamic = 'force-dynamic'

const STATUS_STYLES: Record<RegistrationStatus, { bg: string; label: string }> = {
  draft: { bg: 'bg-muted text-muted-foreground', label: 'Draft' },
  pending_payment: { bg: 'bg-yellow-100 text-yellow-800', label: 'Pending' },
  paid: { bg: 'bg-secondary text-primary', label: 'Paid' },
  expired: { bg: 'bg-destructive/10 text-destructive', label: 'Expired' },
  cancelled: { bg: 'bg-muted text-muted-foreground', label: 'Cancelled' },
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: household } = await supabase
    .from('households')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!household) redirect('/auth/onboarding')

  // Get dancers for filter chips
  const { data: dancers } = await supabase
    .from('dancers')
    .select('id, first_name, last_name')
    .eq('household_id', household.id)
    .eq('is_active', true)
    .order('first_name')

  // Get registrations with feis info and entries
  const { data: registrations } = await supabase
    .from('registrations')
    .select(`
      *,
      feis_listings(name, feis_date, venue_name),
      registration_entries(dancer_id, feis_competitions(display_name))
    `)
    .eq('household_id', household.id)
    .order('created_at', { ascending: false })

  const typedRegistrations = (registrations ?? []) as (Registration & {
    feis_listings: { name: string; feis_date: string; venue_name: string }
    registration_entries: { dancer_id: string; feis_competitions: { display_name: string } }[]
  })[]

  const typedDancers = (dancers ?? []) as Pick<Dancer, 'id' | 'first_name' | 'last_name'>[]

  const hasRegistrations = typedRegistrations.length > 0

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Link
          href="/feiseanna"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-[var(--color-feis-green-600)]"
        >
          Browse Feiseanna
        </Link>
      </div>

      {/* Dancer filter chips */}
      {typedDancers.length > 0 && hasRegistrations && (
        <div className="mb-4 flex flex-wrap gap-2">
          <span className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
            All Dancers
          </span>
          {typedDancers.map(d => (
            <span key={d.id} className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
              {d.first_name}
            </span>
          ))}
        </div>
      )}

      {!hasRegistrations ? (
        <div className="feis-card px-6 py-12 text-center">
          <p className="text-muted-foreground">No registrations yet.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Browse open feiseanna to get started.
          </p>
          <Link
            href="/feiseanna"
            className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-[var(--color-feis-green-600)]"
          >
            Browse Feiseanna
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {typedRegistrations.map(reg => {
            const status = STATUS_STYLES[reg.status]
            const dancerIds = [...new Set(reg.registration_entries.map(e => e.dancer_id))]
            const dancerNames = dancerIds
              .map(id => typedDancers.find(d => d.id === id))
              .filter(Boolean)
              .map(d => d!.first_name)

            return (
              <div key={reg.id} className="feis-card p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{reg.feis_listings.name}</h3>
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${status.bg}`}>
                        {status.label}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {formatDate(reg.feis_listings.feis_date, { month: 'short' })} &middot; {reg.feis_listings.venue_name}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {dancerNames.join(', ')} &middot; {reg.registration_entries.length} competition{reg.registration_entries.length !== 1 ? 's' : ''}
                    </p>
                    {reg.confirmation_number && (
                      <p className="mt-1 font-mono text-sm font-medium text-primary">
                        {reg.confirmation_number}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    {reg.status === 'paid' && (
                      <div className="font-semibold">{formatCents(reg.total_cents)}</div>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex gap-3">
                  {reg.status === 'paid' && (
                    <Link
                      href={`/feiseanna/${reg.feis_listing_id}/register/success?session_id=${reg.stripe_checkout_session_id}`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      View Details
                    </Link>
                  )}
                  {reg.status === 'draft' && (
                    <Link
                      href={`/feiseanna/${reg.feis_listing_id}/register?step=3`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      Continue Registration
                    </Link>
                  )}
                  {reg.status === 'expired' && (
                    <Link
                      href={`/feiseanna/${reg.feis_listing_id}/register`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      Register Again
                    </Link>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
