'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useSupabase } from '@/hooks/use-supabase'
import { getExistingRegistration } from './actions'
import { Step1Dancers } from '@/components/registration/step1-dancers'
import type {
  FeisListing,
  FeeSchedule,
  FeisCompetition,
  Dancer,
  DancerDanceLevel,
  Registration,
  RegistrationEntry,
} from '@/lib/types/feis-listing'

type RegistrationWithEntries = Registration & { registration_entries: RegistrationEntry[] }

type PageData = {
  listing: FeisListing
  feeSchedule: FeeSchedule | null
  competitions: FeisCompetition[]
  dancers: (Dancer & { dance_levels: DancerDanceLevel[] })[]
  existingRegistration: RegistrationWithEntries | null
  expiredHold: boolean
}

type LoadState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: PageData }

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-feis-cream)]">
      <div className="text-center text-muted-foreground">Loading…</div>
    </div>
  )
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-feis-cream)]">
      <div className="feis-card max-w-sm px-8 py-10 text-center">
        <p className="mb-4 text-sm text-destructive">{message}</p>
        <Link href="/feiseanna" className="text-sm font-medium text-primary hover:underline">
          Back to Feiseanna
        </Link>
      </div>
    </div>
  )
}

function UnauthenticatedScreen({ feisId }: { feisId: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-feis-cream)]">
      <div className="feis-card max-w-sm px-8 py-10 text-center">
        <h2 className="mb-2 text-lg font-semibold">Sign in to register</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          You need an account to register dancers for this feis.
        </p>
        <Link
          href={`/auth/login?redirect=/feiseanna/${feisId}/register`}
          className="inline-block rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-[var(--color-feis-green-600)]"
        >
          Sign In
        </Link>
        <p className="mt-4 text-sm text-muted-foreground">
          No account?{' '}
          <Link
            href={`/auth/signup?redirect=/feiseanna/${feisId}/register`}
            className="font-medium text-primary hover:underline"
          >
            Create one
          </Link>
        </p>
      </div>
    </div>
  )
}

const STEP_LABELS = ['Who&apos;s Dancing?', 'Choose Competitions', 'Review & Pay']

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="mb-8 flex items-center gap-2">
      {[1, 2, 3].map((step) => (
        <div key={step} className="flex items-center gap-2">
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
              step === current
                ? 'bg-primary text-primary-foreground'
                : step < current
                  ? 'bg-[var(--color-feis-green-light)] text-primary'
                  : 'bg-muted text-muted-foreground'
            }`}
          >
            {step < current ? (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              step
            )}
          </div>
          {step < 3 && (
            <div
              className={`h-px w-8 ${step < current ? 'bg-primary' : 'bg-border'}`}
            />
          )}
        </div>
      ))}
    </div>
  )
}

export default function RegisterPage() {
  const params = useParams()
  const router = useRouter()
  const feisId = params.id as string
  const supabase = useSupabase()

  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  const [step, setStep] = useState(1)
  const [selectedDancerIds, setSelectedDancerIds] = useState<string[]>([])

  useEffect(() => {
    async function load() {
      // Check auth
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setLoadState({ status: 'unauthenticated' })
        return
      }

      // Fetch household
      const { data: household, error: householdError } = await supabase
        .from('households')
        .select('id')
        .eq('user_id', user.id)
        .single()

      if (householdError || !household) {
        router.push('/auth/onboarding')
        return
      }

      // Fetch all data in parallel
      const [listingResult, feesResult, compsResult, dancersResult, existingRegResult] =
        await Promise.all([
          supabase
            .from('feis_listings')
            .select('*')
            .eq('id', feisId)
            .eq('status', 'open')
            .single(),
          supabase
            .from('fee_schedules')
            .select('*')
            .eq('feis_listing_id', feisId)
            .single(),
          supabase
            .from('feis_competitions')
            .select('*')
            .eq('feis_listing_id', feisId)
            .eq('enabled', true),
          supabase
            .from('dancers')
            .select('*, dance_levels:dancer_dance_levels(*)')
            .eq('household_id', household.id)
            .eq('is_active', true)
            .order('first_name', { ascending: true }),
          getExistingRegistration(feisId),
        ])

      if (listingResult.error || !listingResult.data) {
        setLoadState({
          status: 'error',
          message: 'This feis is no longer available for registration.',
        })
        return
      }

      setLoadState({
        status: 'ready',
        data: {
          listing: listingResult.data as FeisListing,
          feeSchedule: feesResult.data as FeeSchedule | null,
          competitions: (compsResult.data ?? []) as FeisCompetition[],
          dancers: (dancersResult.data ?? []) as (Dancer & { dance_levels: DancerDanceLevel[] })[],
          existingRegistration:
            existingRegResult.registration as RegistrationWithEntries | null ?? null,
          expiredHold: existingRegResult.expired === true,
        },
      })
    }

    load()
  }, [feisId, supabase, router])

  if (loadState.status === 'loading') return <LoadingScreen />
  if (loadState.status === 'unauthenticated') return <UnauthenticatedScreen feisId={feisId} />
  if (loadState.status === 'error') return <ErrorScreen message={loadState.message} />

  const { listing, feeSchedule: _feeSchedule, competitions: _competitions, dancers, expiredHold } =
    loadState.data

  const ageCutoffDate = listing.age_cutoff_date
    ? new Date(listing.age_cutoff_date + 'T00:00:00')
    : listing.feis_date
      ? new Date(listing.feis_date + 'T00:00:00')
      : new Date()

  function handleStep1Next(ids: string[]) {
    setSelectedDancerIds(ids)
    setStep(2)
  }

  return (
    <div className="min-h-screen bg-[var(--color-feis-cream)]">
      <div className="mx-auto max-w-2xl px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <Link
            href={`/feiseanna/${feisId}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            {listing.name}
          </Link>
          <h1 className="mt-2 text-2xl font-bold">Register</h1>
        </div>

        {/* Expired hold notice */}
        {expiredHold && (
          <div className="mb-6 rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
            Your previous registration hold expired. You can start a new registration below.
          </div>
        )}

        <StepIndicator current={step} />

        <div className="feis-card p-6">
          {step === 1 && (
            <Step1Dancers
              dancers={dancers}
              feisName={listing.name ?? 'this feis'}
              ageCutoffDate={ageCutoffDate}
              onNext={handleStep1Next}
            />
          )}

          {step === 2 && (
            <div>
              <h2 className="mb-1 text-xl font-semibold">Choose Competitions</h2>
              <p className="mb-6 text-sm text-muted-foreground">
                {selectedDancerIds.length === 1
                  ? 'Select competitions for your dancer.'
                  : `Select competitions for your ${selectedDancerIds.length} dancers.`}
              </p>
              <p className="text-sm text-muted-foreground">
                Competition selection coming in the next step.
              </p>
              <div className="mt-8 flex justify-between">
                <button
                  onClick={() => setStep(1)}
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  className="rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-[var(--color-feis-green-600)]"
                >
                  Next: Review &amp; Pay
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="mb-1 text-xl font-semibold">Review &amp; Pay</h2>
              <p className="mb-6 text-sm text-muted-foreground">
                Review your selections before proceeding to payment.
              </p>
              <p className="text-sm text-muted-foreground">
                Payment flow coming in the next step.
              </p>
              <div className="mt-8 flex justify-between">
                <button
                  onClick={() => setStep(2)}
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
                >
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
