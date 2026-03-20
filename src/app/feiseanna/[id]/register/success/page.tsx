import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { RegistrationStatus } from '@/lib/types/feis-listing'

export const dynamic = 'force-dynamic'

interface SuccessPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ session_id?: string }>
}

export default async function SuccessPage({ params, searchParams }: SuccessPageProps) {
  const { id: feisId } = await params
  const { session_id: sessionId } = await searchParams

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/auth/login?redirect=/feiseanna/${feisId}/register/success${sessionId ? `?session_id=${sessionId}` : ''}`)
  }

  // Look up registration by checkout session ID or by household + feis
  let registrationId: string | null = null
  let status: RegistrationStatus | null = null
  let confirmationNumber: string | null = null

  if (sessionId) {
    const { data: reg, error } = await supabase
      .from('registrations')
      .select('id, status, confirmation_number')
      .eq('stripe_checkout_session_id', sessionId)
      .single()

    if (!error && reg) {
      registrationId = reg.id
      status = reg.status as RegistrationStatus
      confirmationNumber = reg.confirmation_number
    }
  }

  // Fallback: look up by household + feis listing
  if (!registrationId) {
    const { data: household } = await supabase
      .from('households')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (household) {
      const { data: reg, error } = await supabase
        .from('registrations')
        .select('id, status, confirmation_number')
        .eq('feis_listing_id', feisId)
        .eq('household_id', household.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (!error && reg) {
        registrationId = reg.id
        status = reg.status as RegistrationStatus
        confirmationNumber = reg.confirmation_number
      }
    }
  }

  if (!registrationId || !status) {
    redirect(`/feiseanna/${feisId}`)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-feis-cream)]">
      <div className="feis-card mx-auto max-w-md px-8 py-10 text-center">
        {status === 'paid' && (
          <>
            <div className="mb-4 flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-feis-green-light)]">
                <svg
                  className="h-8 w-8 text-[var(--color-feis-green)]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <h1 className="mb-2 text-2xl font-bold text-[var(--color-feis-charcoal)]">
              You&apos;re registered!
            </h1>
            <p className="mb-6 text-sm text-muted-foreground">
              Your registration is confirmed and payment received.
            </p>
            {confirmationNumber && (
              <div className="mb-6 rounded-md bg-[var(--color-feis-green-light)] px-6 py-4">
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Confirmation Number
                </div>
                <div className="mt-1 font-mono text-2xl font-bold text-[var(--color-feis-green)]">
                  {confirmationNumber}
                </div>
              </div>
            )}
            <p className="mb-6 text-sm text-muted-foreground">
              A confirmation email has been sent to your account.
            </p>
            <Link
              href="/dashboard"
              className="inline-block rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-[var(--color-feis-green-600)]"
            >
              View My Registrations
            </Link>
          </>
        )}

        {status === 'pending_payment' && (
          <>
            <meta httpEquiv="refresh" content="3" />
            <div className="mb-4 flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <svg
                  className="h-8 w-8 animate-pulse text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
            </div>
            <h1 className="mb-2 text-2xl font-bold text-[var(--color-feis-charcoal)]">
              Processing...
            </h1>
            <p className="text-sm text-muted-foreground">
              Your payment is being processed. This page will refresh automatically.
            </p>
          </>
        )}

        {status === 'expired' && (
          <>
            <div className="mb-4 flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-50">
                <svg
                  className="h-8 w-8 text-[var(--color-feis-orange)]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
            </div>
            <h1 className="mb-2 text-2xl font-bold text-[var(--color-feis-charcoal)]">
              Session Expired
            </h1>
            <p className="mb-6 text-sm text-muted-foreground">
              Your registration session has expired. Please start a new registration.
            </p>
            <Link
              href={`/feiseanna/${feisId}/register`}
              className="inline-block rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-[var(--color-feis-green-600)]"
            >
              Start Over
            </Link>
          </>
        )}

        {status === 'cancelled' && (
          <>
            <div className="mb-4 flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <svg
                  className="h-8 w-8 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            </div>
            <h1 className="mb-2 text-2xl font-bold text-[var(--color-feis-charcoal)]">
              Registration Cancelled
            </h1>
            <p className="mb-6 text-sm text-muted-foreground">
              Your registration has been cancelled. You can register again at any time.
            </p>
            <Link
              href={`/feiseanna/${feisId}/register`}
              className="inline-block rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-[var(--color-feis-green-600)]"
            >
              Register Again
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
