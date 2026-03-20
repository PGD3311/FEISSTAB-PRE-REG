'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useSupabase } from '@/hooks/use-supabase'
import { getExistingRegistration, createDraftRegistration, createCheckoutSession, cancelRegistration } from './actions'
import { calculateFees } from '@/lib/engine/fee-calculator'
import { Step1Dancers } from '@/components/registration/step1-dancers'
import { Step2Cart } from '@/components/registration/step2-cart'
import { Step3Review } from '@/components/registration/step3-review'
import type {
  FeisListing,
  FeeSchedule,
  FeeEntry,
  FeeBreakdown,
  FeisCompetition,
  Dancer,
  DancerDanceLevel,
  Level,
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
  const [cart, setCart] = useState<Record<string, string[]>>({})
  const [registrationId, setRegistrationId] = useState<string | null>(null)
  const [holdExpiresAt, setHoldExpiresAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

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

  const { listing, feeSchedule, competitions, dancers, existingRegistration, expiredHold } =
    loadState.data

  const ageCutoffDate = listing.age_cutoff_date
    ? new Date(listing.age_cutoff_date + 'T00:00:00')
    : listing.feis_date
      ? new Date(listing.feis_date + 'T00:00:00')
      : new Date()

  // Get levels from syllabus snapshot
  const levels: Level[] = listing.syllabus_snapshot?.levels ?? []

  // Determine if registration is in late period
  const isLate = listing.reg_closes_at ? new Date() > new Date(listing.reg_closes_at) : false

  // Get selected dancers with their dance levels
  const selectedDancers = dancers.filter(d => selectedDancerIds.includes(d.id))

  // Compute fee breakdown for the current cart
  const feeBreakdown: FeeBreakdown = useMemo(() => {
    if (!feeSchedule || Object.keys(cart).length === 0) {
      return {
        line_items: [],
        event_fee_cents: 0,
        subtotal_per_dancer: {},
        subtotal_before_cap_cents: 0,
        family_cap_applied: false,
        grand_total_cents: 0
      }
    }
    const entries: FeeEntry[] = []
    for (const [dancerId, compIds] of Object.entries(cart)) {
      for (const compId of compIds) {
        const comp = competitions.find(c => c.id === compId)
        if (comp) {
          entries.push({
            dancer_id: dancerId,
            fee_category: comp.fee_category,
            is_late: isLate,
            is_day_of: false
          })
        }
      }
    }
    return calculateFees(feeSchedule, entries)
  }, [cart, competitions, feeSchedule, isLate])

  function handleStep1Next(ids: string[]) {
    setSelectedDancerIds(ids)
    setStep(2)
  }

  function handleStep2Next(newCart: Record<string, string[]>) {
    setCart(newCart)
    setStep(3)
  }

  async function handleCreateDraft() {
    if (!feeSchedule) return
    setLoading(true)
    try {
      const entries: { dancerId: string; competitionId: string }[] = []
      for (const [dancerId, compIds] of Object.entries(cart)) {
        for (const compId of compIds) {
          entries.push({ dancerId, competitionId: compId })
        }
      }

      const result = await createDraftRegistration({
        feisListingId: feisId,
        entries,
        consentAcceptedAt: new Date().toISOString(),
        consentIp: '0.0.0.0' // Server will capture real IP
      })

      if ('error' in result) {
        alert(result.error)
        return
      }

      setRegistrationId(result.registrationId)
      setHoldExpiresAt(result.holdExpiresAt)
    } finally {
      setLoading(false)
    }
  }

  async function handlePay() {
    if (!registrationId) return
    setLoading(true)
    try {
      const result = await createCheckoutSession(registrationId)

      if ('error' in result) {
        alert(result.error)
        return
      }

      if (result.url) {
        window.location.href = result.url
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleCancel() {
    if (!registrationId) return
    if (!confirm('Cancel this registration? You can start over.')) return
    setLoading(true)
    try {
      await cancelRegistration(registrationId)
      setRegistrationId(null)
      setHoldExpiresAt(null)
      setCart({})
      setStep(1)
    } finally {
      setLoading(false)
    }
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

          {step === 2 && feeSchedule && (
            <Step2Cart
              selectedDancers={selectedDancers}
              competitions={competitions}
              feeSchedule={feeSchedule}
              ageCutoffDate={ageCutoffDate}
              levels={levels}
              isLate={isLate}
              onNext={handleStep2Next}
              onBack={() => setStep(1)}
            />
          )}

          {step === 3 && (
            <Step3Review
              feis={listing}
              dancers={selectedDancers}
              cart={cart}
              competitions={competitions}
              feeBreakdown={feeBreakdown}
              registrationId={registrationId}
              holdExpiresAt={holdExpiresAt}
              onCreateDraft={handleCreateDraft}
              onPay={handlePay}
              onCancel={handleCancel}
              onBack={() => setStep(2)}
              loading={loading}
            />
          )}
        </div>
      </div>
    </div>
  )
}
