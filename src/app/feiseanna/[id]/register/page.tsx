'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useSupabase } from '@/hooks/use-supabase'
import { REGISTRATION_COLUMNS } from '@/lib/registration-columns'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { isHouseholdComplete } from '@/lib/household'
import { getExistingRegistration } from './actions'
import {
  EntryPage,
  type DancerWithLevels,
  type EntryPageData,
  type RegistrationWithEntries
} from '@/components/registration/entry-page'
import type { FeeSchedule, FeisCompetition, FeisListing } from '@/lib/types/feis-listing'

type LoadState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: EntryPageData }

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-feis-cream)] px-4">
      {children}
    </div>
  )
}

export default function RegisterPage() {
  const params = useParams()
  const router = useRouter()
  const feisId = params.id as string
  const supabase = useSupabase()

  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    async function load() {
      try {
        const {
          data: { user }
        } = await supabase.auth.getUser()

        if (!user) {
          setLoadState({ status: 'unauthenticated' })
          return
        }

        const { data: household, error: householdError } = await supabase
          .from('households')
          .select(
            'id, first_name, last_name, phone, address_line1, city, state_region, postal_code'
          )
          .eq('user_id', user.id)
          .single()

        if (householdError || !household) {
          router.push('/auth/onboarding')
          return
        }

        // The feis needs a contact name, phone and address before anyone registers
        if (!isHouseholdComplete(household)) {
          router.push(
            `/dashboard/account?next=${encodeURIComponent(`/feiseanna/${feisId}/register`)}`
          )
          return
        }

        const [listingResult, feesResult, competitions, dancersResult, heldResult, paidResult] =
          await Promise.all([
            supabase
              .from('feis_listings')
              .select('*')
              .eq('id', feisId)
              .eq('status', 'open')
              .single(),
            supabase.from('fee_schedules').select('*').eq('feis_listing_id', feisId).single(),
            // Every enabled competition, read in pages: PostgREST returns at most 1000 rows per
            // request, and Submit judges eligibility against the feis's whole list
            fetchAllRows<FeisCompetition>((from, to) =>
              supabase
                .from('feis_competitions')
                .select('*', { count: 'exact' })
                .eq('feis_listing_id', feisId)
                .eq('enabled', true)
                .order('sort_order', { ascending: true })
                .order('id', { ascending: true })
                .range(from, to)
            ),
            supabase
              .from('dancers')
              .select('*, dance_levels:dancer_dance_levels(*)')
              .eq('household_id', household.id)
              .eq('is_active', true)
              .order('date_of_birth', { ascending: true }),
            getExistingRegistration(feisId),
            supabase
              .from('registrations')
              .select(`${REGISTRATION_COLUMNS}, registration_entries(*)`)
              .eq('feis_listing_id', feisId)
              .eq('household_id', household.id)
              .eq('status', 'paid')
              .maybeSingle()
          ])

        if (listingResult.error || !listingResult.data) {
          setLoadState({
            status: 'error',
            message: 'This feis is no longer taking entries.'
          })
          return
        }
        for (const result of [dancersResult, paidResult]) {
          if (result.error) throw result.error
        }
        if ('error' in heldResult) throw new Error(heldResult.error)

        const dancers = (dancersResult.data ?? []) as DancerWithLevels[]

        const numbersResult = await supabase
          .from('competitor_numbers')
          .select('dancer_id, competitor_number')
          .eq('feis_listing_id', feisId)
          .in(
            'dancer_id',
            dancers.map((d) => d.id)
          )
        if (numbersResult.error) throw numbersResult.error

        const numbers: Record<string, number> = {}
        for (const row of numbersResult.data ?? []) numbers[row.dancer_id] = row.competitor_number

        setLoadState({
          status: 'ready',
          data: {
            familyName: household.last_name
              ? `The ${household.last_name} family`
              : (household.first_name ?? 'Your family'),
            listing: listingResult.data as FeisListing,
            feeSchedule: (feesResult.data as FeeSchedule | null) ?? null,
            competitions,
            dancers,
            heldRegistration: (heldResult.registration as RegistrationWithEntries | null) ?? null,
            paidRegistration: (paidResult.data as RegistrationWithEntries | null) ?? null,
            numbers,
            expiredHold: heldResult.expired === true
          }
        })
      } catch (err) {
        console.error('Failed to load the entry page:', err)
        setLoadState({
          status: 'error',
          message: 'The entry page could not load. Refresh to try again.'
        })
      }
    }

    load()
  }, [feisId, supabase, router])

  if (loadState.status === 'loading') {
    return (
      <Shell>
        <p className="text-muted-foreground">Loading your dancers…</p>
      </Shell>
    )
  }

  if (loadState.status === 'unauthenticated') {
    const next = encodeURIComponent(`/feiseanna/${feisId}/register`)
    return (
      <Shell>
        <div className="feis-receipt max-w-sm px-7 py-8 text-center">
          <h1 className="text-[22px] font-extrabold [font-stretch:75%]">Sign in to enter</h1>
          <p className="mt-2 mb-5 text-sm text-muted-foreground">
            Your dancers&apos; details are saved in your family account, so you only type them once.
          </p>
          <Link
            href={`/auth/login?redirect=${next}`}
            className="inline-block rounded-[3px] bg-primary px-6 py-2.5 text-sm font-bold text-primary-foreground"
          >
            Sign in
          </Link>
          <p className="mt-4 text-sm text-muted-foreground">
            New here?{' '}
            <Link
              href={`/auth/signup?redirect=${next}`}
              className="font-semibold text-primary underline"
            >
              Create a family account
            </Link>
          </p>
        </div>
      </Shell>
    )
  }

  if (loadState.status === 'error') {
    return (
      <Shell>
        <div className="feis-receipt max-w-sm px-7 py-8 text-center">
          <p className="mb-4 text-sm">{loadState.message}</p>
          <Link href="/" className="text-sm font-semibold text-primary underline">
            See upcoming feiseanna
          </Link>
        </div>
      </Shell>
    )
  }

  return <EntryPage data={loadState.data} feisId={feisId} />
}
