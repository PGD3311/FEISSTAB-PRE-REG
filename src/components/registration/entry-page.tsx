'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { formatCents, formatDate, parseLocalDate } from '@/lib/format'
import { calculateFees } from '@/lib/engine/fee-calculator'
import { calculateAgeOnDate, getEligibleCompetitions } from '@/lib/engine/eligibility'
import {
  dancerLevelSummary,
  entryDeadline,
  entryFeesPerDancer,
  formatDeadline
} from '@/lib/entry-display'
import {
  createDraftRegistration,
  createCheckoutSession,
  cancelRegistration
} from '@/app/feiseanna/[id]/register/actions'
import { DancerEntry } from '@/components/registration/dancer-entry'
import { FamilyReceipt, PaidReceipt, type ReceiptLine } from '@/components/registration/family-receipt'
import type {
  Dancer,
  DancerDanceLevel,
  DancerProfile,
  EligibleCompetition,
  FeeEntry,
  FeeSchedule,
  FeisCompetition,
  FeisListing,
  Registration,
  RegistrationEntry
} from '@/lib/types/feis-listing'

export type DancerWithLevels = Dancer & { dance_levels: DancerDanceLevel[] }
export type RegistrationWithEntries = Registration & { registration_entries: RegistrationEntry[] }
type Cart = Record<string, string[]>

export type EntryPageData = {
  familyName: string
  listing: FeisListing
  feeSchedule: FeeSchedule | null
  competitions: FeisCompetition[]
  dancers: DancerWithLevels[]
  heldRegistration: RegistrationWithEntries | null
  paidRegistration: RegistrationWithEntries | null
  numbers: Record<string, number>
  expiredHold: boolean
}

function cartFrom(registration: RegistrationWithEntries | null): Cart {
  const cart: Cart = {}
  for (const entry of registration?.registration_entries ?? []) {
    cart[entry.dancer_id] = [...(cart[entry.dancer_id] ?? []), entry.feis_competition_id]
  }
  return cart
}

function profileOf(dancer: DancerWithLevels): DancerProfile {
  const danceLevels: Record<string, string> = {}
  for (const dl of dancer.dance_levels) danceLevels[dl.dance_key] = dl.level_key
  return {
    dob: parseLocalDate(dancer.date_of_birth),
    gender: dancer.gender,
    championshipStatus: dancer.championship_status,
    danceLevels
  }
}

function ageCutoffOf(listing: FeisListing): Date {
  if (listing.age_cutoff_date) return parseLocalDate(listing.age_cutoff_date)
  if (listing.feis_date) return parseLocalDate(listing.feis_date)
  return new Date()
}

export function EntryPage({ data, feisId }: { data: EntryPageData; feisId: string }) {
  const { listing, feeSchedule, competitions, dancers, paidRegistration, numbers } = data
  const timeZone = listing.timezone ?? 'America/New_York'
  const levels = listing.syllabus_snapshot?.levels ?? []
  const ageCutoffDate = ageCutoffOf(listing)
  const deadline = entryDeadline(listing)

  const [cart, setCart] = useState<Cart>(() =>
    cartFrom(paidRegistration ?? data.heldRegistration)
  )
  const [editingId, setEditingId] = useState<string | null>(null)
  const [registrationId, setRegistrationId] = useState<string | null>(data.heldRegistration?.id ?? null)
  const [holdExpiresAt, setHoldExpiresAt] = useState<string | null>(
    data.heldRegistration?.hold_expires_at ?? null
  )
  const [paymentStarted, setPaymentStarted] = useState(
    data.heldRegistration?.status === 'pending_payment'
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const paid = paidRegistration !== null
  const held = registrationId !== null
  const canEdit = !paid && !held && !deadline.closed && feeSchedule !== null

  const competitionById = useMemo(
    () => new Map(competitions.map((c) => [c.id, c])),
    [competitions]
  )

  const eligibleByDancer = useMemo(() => {
    const map: Record<string, EligibleCompetition[]> = {}
    const cutoff = ageCutoffOf(listing)
    const syllabusLevels = listing.syllabus_snapshot?.levels ?? []
    for (const dancer of dancers) {
      map[dancer.id] = getEligibleCompetitions(profileOf(dancer), competitions, cutoff, syllabusLevels)
    }
    return map
  }, [dancers, competitions, listing])

  const feeEntries: FeeEntry[] = useMemo(() => {
    const entries: FeeEntry[] = []
    for (const dancer of dancers) {
      for (const compId of cart[dancer.id] ?? []) {
        const comp = competitionById.get(compId)
        if (!comp) continue
        entries.push({
          dancer_id: dancer.id,
          fee_category: comp.fee_category,
          fee_cents_override: comp.fee_cents,
          exclude_from_family_cap: comp.exclude_from_family_cap,
          is_day_of: false
        })
      }
    }
    return entries
  }, [cart, dancers, competitionById])

  const breakdown = useMemo(
    () => (feeSchedule && feeEntries.length > 0 ? calculateFees(feeSchedule, feeEntries) : null),
    [feeSchedule, feeEntries]
  )

  const receiptLines: ReceiptLine[] = useMemo(() => {
    if (!breakdown || !feeSchedule) return []
    const perDancer = entryFeesPerDancer(breakdown)
    const lines: ReceiptLine[] = []
    for (const dancer of dancers) {
      const count = (cart[dancer.id] ?? []).length
      if (count === 0) continue
      lines.push({
        label: `${dancer.first_name}, ${count} ${count === 1 ? 'dance' : 'dances'}`,
        cents: perDancer[dancer.id] ?? 0
      })
    }
    if (breakdown.event_fee_cents > 0) {
      lines.push({ label: 'Family fee', cents: breakdown.event_fee_cents })
    }
    if (breakdown.late_fees_cents > 0) {
      lines.push({ label: 'Late fee', cents: breakdown.late_fees_cents })
    }
    if (breakdown.family_cap_applied) {
      lines.push({ label: 'Family max applied', cents: -breakdown.family_cap_savings_cents })
    } else if (feeSchedule.family_cap_cents !== null) {
      lines.push({ label: 'Entries are capped at', cents: feeSchedule.family_cap_cents, quiet: true })
    }
    return lines
  }, [breakdown, feeSchedule, dancers, cart])

  const totalCents = breakdown?.grand_total_cents ?? 0
  const dancesChosen = feeEntries.length

  function toggle(dancerId: string, competitionId: string) {
    setCart((prev) => {
      const current = prev[dancerId] ?? []
      const next = current.includes(competitionId)
        ? current.filter((id) => id !== competitionId)
        : [...current, competitionId]
      return { ...prev, [dancerId]: next }
    })
  }

  async function handlePay() {
    setError(null)
    setLoading(true)
    try {
      let regId: string | null = registrationId
      if (regId === null) {
        const result = await createDraftRegistration({
          feisListingId: feisId,
          entries: Object.entries(cart).flatMap(([dancerId, compIds]) =>
            compIds.map((competitionId) => ({ dancerId, competitionId }))
          ),
          consentAcceptedAt: new Date().toISOString(),
          consentIp: '0.0.0.0'
        })
        if ('error' in result) {
          setError(result.error ?? 'Your entries could not be saved. Try again.')
          return
        }
        regId = result.registrationId
        setRegistrationId(regId)
        setHoldExpiresAt(result.holdExpiresAt)
        setEditingId(null)
      }
      if (regId === null) return

      const checkout = await createCheckoutSession(regId)
      if ('error' in checkout) {
        setError(checkout.error ?? 'The payment page could not be opened. Try again.')
        return
      }
      if (checkout.url) window.location.href = checkout.url
    } catch (err) {
      console.error('Payment failed to start:', err)
      setError('The payment page could not be opened. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleChangeEntries() {
    if (!registrationId) return
    setError(null)
    setLoading(true)
    try {
      const holdOver = holdExpiresAt !== null && new Date(holdExpiresAt) <= new Date()
      const result = await cancelRegistration(registrationId)
      if ('error' in result && !holdOver) {
        setError(result.error ?? 'Your entries could not be reopened. Try again.')
        return
      }
      setRegistrationId(null)
      setHoldExpiresAt(null)
      setPaymentStarted(false)
    } catch (err) {
      console.error('Failed to reopen entries:', err)
      setError('Your entries could not be reopened. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  const activeLateTier = breakdown?.active_late_tier ?? null

  return (
    <div className="min-h-screen bg-[var(--color-feis-cream)] pb-24 lg:pb-0">
      <header className="feis-cover">
        <div className="mx-auto grid max-w-6xl gap-x-6 gap-y-2 px-4 pt-4 pb-6 sm:px-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="flex items-center justify-between gap-4 text-sm md:col-span-2">
            <Link href="/" className="font-extrabold italic opacity-80 hover:opacity-100">
              RunFeis
            </Link>
            <Link href={`/feiseanna/${feisId}`} className="opacity-80 underline-offset-2 hover:underline hover:opacity-100">
              Feis details and fees
            </Link>
          </div>
          <div className="min-w-0 pt-3">
            <h1 className="feis-cover-title text-[clamp(34px,6vw,56px)]">{listing.name}</h1>
            <p className="mt-1.5 opacity-85">
              {formatDate(listing.feis_date, { weekday: 'long', fallback: 'Date to be announced' })}
              {listing.venue_name ? `, ${listing.venue_name}` : ''}
            </p>
          </div>
          {deadline.closesAt && (
            <div className="text-sm md:text-right">
              {deadline.closed ? 'Entries' : 'Entries close'}
              <strong className="block text-[22px] leading-tight font-extrabold text-[#E9C77F] [font-stretch:75%]">
                {deadline.closed ? 'Closed' : formatDeadline(deadline.closesAt, timeZone)}
              </strong>
              {activeLateTier && !deadline.closed && (
                <span className="text-[13px] opacity-85">
                  Late fee of {formatCents(activeLateTier.fee_cents)} per dancer now applies
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl items-start gap-7 px-4 py-7 sm:px-7 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0">
          <h2 className="mb-3.5 text-[22px] font-extrabold [font-stretch:75%]">Your dancers</h2>

          {data.expiredHold && (
            <p className="mb-4 border-l-4 border-[var(--color-feis-orange)] bg-[var(--color-feis-orange-light)] px-4 py-2.5 text-sm text-[var(--color-feis-orange-ink)]">
              Your last set of entries wasn&apos;t paid in time, so the places were released. Choose
              the dances again below.
            </p>
          )}

          {dancers.length === 0 ? (
            <div className="feis-sticker rounded px-5 py-6">
              <p className="font-bold">Add your first dancer</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Enter their date of birth, school and level for each dance. You only do this once;
                every feis uses it to show the dances they can enter.
              </p>
              <Link
                href="/dashboard/dancers/new"
                className="mt-3 inline-block rounded-[3px] bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
              >
                Add a dancer
              </Link>
            </div>
          ) : (
            <div className="grid gap-5">
              {dancers.map((dancer) => {
                const age = calculateAgeOnDate(parseLocalDate(dancer.date_of_birth), ageCutoffDate)
                const level = dancerLevelSummary(dancer.dance_levels, levels, dancer.championship_status)
                return (
                  <DancerEntry
                    key={dancer.id}
                    dancer={dancer}
                    feisName={listing.name ?? ''}
                    details={[`${level}, age ${age}`, ...(dancer.school_name ? [dancer.school_name] : [])]}
                    number={numbers[dancer.id] ?? null}
                    eligible={eligibleByDancer[dancer.id] ?? []}
                    selected={(cart[dancer.id] ?? [])
                      .map((id) => competitionById.get(id))
                      .filter((c): c is FeisCompetition => c !== undefined)}
                    feeSchedule={feeSchedule}
                    editing={canEdit && editingId === dancer.id}
                    canEdit={canEdit}
                    onEdit={() => setEditingId(dancer.id)}
                    onDone={() => setEditingId(null)}
                    onToggle={(compId) => toggle(dancer.id, compId)}
                  />
                )
              })}
            </div>
          )}

          {canEdit && dancers.length > 0 && (
            <Link
              href="/dashboard/dancers/new"
              className="mt-5 inline-block text-sm font-bold text-primary underline underline-offset-[3px]"
            >
              Add another dancer
            </Link>
          )}
        </section>

        {paid ? (
          <PaidReceipt
            familyName={data.familyName}
            totalCents={paidRegistration.total_cents}
            confirmationNumber={paidRegistration.confirmation_number}
            contactEmail={listing.contact_email}
          />
        ) : deadline.closed && !held ? (
          <aside className="feis-receipt px-[18px] py-5">
            <h2 className="text-[22px] font-extrabold [font-stretch:75%]">Entries are closed</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This feis isn&apos;t taking entries any more.
              {listing.contact_email ? ` To ask about a late entry, email ${listing.contact_email}.` : ''}
            </p>
          </aside>
        ) : !feeSchedule ? (
          <aside className="feis-receipt px-[18px] py-5">
            <h2 className="text-[22px] font-extrabold [font-stretch:75%]">Fees not set yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The organiser hasn&apos;t finished setting the fees, so entries can&apos;t be paid yet.
            </p>
          </aside>
        ) : (
          <div className="lg:sticky lg:top-6">
            <FamilyReceipt
              familyName={data.familyName}
              lines={receiptLines}
              totalCents={totalCents}
              termsUrl={listing.terms_url}
              holdExpiresAt={holdExpiresAt}
              paymentStarted={paymentStarted}
              loading={loading}
              error={error}
              onPay={handlePay}
              onChangeEntries={handleChangeEntries}
            />
          </div>
        )}
      </main>

      {!paid && dancesChosen > 0 && (
        <div className="fixed inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-[var(--color-feis-charcoal)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] text-white lg:hidden">
          <div>
            <span className="block text-xs opacity-70">
              {dancesChosen} {dancesChosen === 1 ? 'dance' : 'dances'}
              {breakdown && breakdown.event_fee_cents > 0 ? ' and the family fee' : ''}
            </span>
            <strong className="text-[30px] leading-none font-black tabular-nums [font-stretch:65%]">
              {formatCents(totalCents)}
            </strong>
          </div>
          <a
            href="#family-total"
            className="rounded-[3px] bg-[#E9C77F] px-3.5 py-2.5 font-extrabold text-[var(--color-feis-charcoal)]"
          >
            Review and pay
          </a>
        </div>
      )}
    </div>
  )
}
