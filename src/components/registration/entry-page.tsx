'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { formatCents, parseLocalDate } from '@/lib/format'
import { calculateFees, getActiveLateTier } from '@/lib/engine/fee-calculator'
import { calculateAgeOnDate, getEligibleCompetitions } from '@/lib/engine/eligibility'
import {
  ageCutoffDateFor,
  toDancerProfile,
  type RequestedEntry
} from '@/lib/engine/order-validation'
import { feeEntriesFor } from '@/lib/engine/purchase-snapshot'
import { dancerLevelSummary, entryDeadline, entryFeesPerDancer } from '@/lib/entry-display'
import {
  createDraftRegistration,
  createCheckoutSession,
  cancelRegistration
} from '@/app/feiseanna/[id]/register/actions'
import { FeisCover } from '@/components/feis-cover'
import { DancerEntry } from '@/components/registration/dancer-entry'
import {
  FamilyReceipt,
  PaidReceipt,
  type ReceiptLine
} from '@/components/registration/family-receipt'
import type {
  Dancer,
  DancerDanceLevel,
  EligibleCompetition,
  FeeBreakdown,
  FeeSchedule,
  FeisCompetition,
  FeisListing,
  Registration,
  RegistrationEntry
} from '@/lib/types/feis-listing'

export type DancerWithLevels = Dancer & { dance_levels: DancerDanceLevel[] }
export type RegistrationWithEntries = Registration & {
  registration_entries: RegistrationEntry[]
}
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

export function EntryPage({ data, feisId }: { data: EntryPageData; feisId: string }) {
  const { listing, feeSchedule, competitions, dancers, paidRegistration, numbers } = data
  const levels = listing.syllabus_snapshot?.levels ?? []
  // The cutoff Submit uses: the organiser's date, otherwise January 1 of the feis year
  const ageCutoffDate = useMemo(() => ageCutoffDateFor(listing, new Date()), [listing])
  const deadline = entryDeadline(listing)

  const [cart, setCart] = useState<Cart>(() => cartFrom(paidRegistration ?? data.heldRegistration))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [registrationId, setRegistrationId] = useState<string | null>(
    data.heldRegistration?.id ?? null
  )
  const [holdExpiresAt, setHoldExpiresAt] = useState<string | null>(
    data.heldRegistration?.hold_expires_at ?? null
  )
  const [paymentStarted, setPaymentStarted] = useState(
    data.heldRegistration?.status === 'pending_payment'
  )
  // The price the server froze for the order in progress; the cart's own sum is an estimate
  const [orderBreakdown, setOrderBreakdown] = useState<FeeBreakdown | null>(
    data.heldRegistration?.purchase_snapshot?.pricing.breakdown ?? null
  )
  const [loading, setLoading] = useState(false)
  // The pinned total bar hides while the full receipt is on screen
  const [receiptVisible, setReceiptVisible] = useState(false)

  useEffect(() => {
    const receipt = document.getElementById('family-total')
    if (!receipt || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => setReceiptVisible(entry.isIntersecting),
      {
        threshold: 0.15
      }
    )
    observer.observe(receipt)
    return () => observer.disconnect()
  }, [])

  // Back from Stripe: the browser can restore this page exactly as it was left, still busy from
  // the Pay click, which would leave Pay and Change entries disabled. Make them work again
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) setLoading(false)
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])
  const [error, setError] = useState<string | null>(null)

  const paid = paidRegistration !== null
  const held = registrationId !== null
  const canEdit = !paid && !held && !deadline.closed && feeSchedule !== null

  const competitionById = useMemo(() => new Map(competitions.map((c) => [c.id, c])), [competitions])

  const eligibleByDancer = useMemo(() => {
    const map: Record<string, EligibleCompetition[]> = {}
    const syllabusLevels = listing.syllabus_snapshot?.levels ?? []
    for (const dancer of dancers) {
      map[dancer.id] = getEligibleCompetitions(
        toDancerProfile(dancer),
        competitions,
        ageCutoffDate,
        syllabusLevels
      )
    }
    return map
  }, [dancers, competitions, listing, ageCutoffDate])

  // What Pay submits: each dancer's chosen dances that this feis still offers
  const requestedEntries: RequestedEntry[] = useMemo(
    () =>
      dancers.flatMap((dancer) =>
        (cart[dancer.id] ?? [])
          .filter((competitionId) => competitionById.has(competitionId))
          .map((competitionId) => ({ dancerId: dancer.id, competitionId }))
      ),
    [cart, dancers, competitionById]
  )

  // Priced the way Submit prices it; once Submit has run, its frozen price is shown instead
  const cartBreakdown = useMemo(
    () =>
      feeSchedule && requestedEntries.length > 0
        ? calculateFees(feeSchedule, feeEntriesFor(requestedEntries, competitionById))
        : null,
    [feeSchedule, requestedEntries, competitionById]
  )
  const breakdown = orderBreakdown ?? cartBreakdown

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
      lines.push({
        label: 'Family max applied',
        cents: -breakdown.family_cap_savings_cents
      })
    } else if (feeSchedule.family_cap_cents !== null) {
      lines.push({
        label: 'Entries are capped at',
        cents: feeSchedule.family_cap_cents,
        quiet: true
      })
    }
    return lines
  }, [breakdown, feeSchedule, dancers, cart])

  const totalCents = breakdown?.grand_total_cents ?? 0
  const dancesChosen = requestedEntries.length

  function toggle(dancerId: string, competitionId: string) {
    setCart((prev) => {
      const current = prev[dancerId] ?? []
      const next = current.includes(competitionId)
        ? current.filter((id) => id !== competitionId)
        : [...current, competitionId]
      return { ...prev, [dancerId]: next }
    })
  }

  // Where a family goes once Stripe has taken a payment for the order: the success page
  // confirms it, or says what happens next
  const successHref = `/feiseanna/${feisId}/register/success`

  // The order can't be paid any more: forget it, keep the cart, and Pay submits a fresh one
  function startAgain(message: string) {
    setRegistrationId(null)
    setHoldExpiresAt(null)
    setOrderBreakdown(null)
    setPaymentStarted(false)
    setError(message)
  }

  async function handlePay(consentAccepted: boolean) {
    setError(null)
    setLoading(true)
    let leaving = false
    try {
      let regId: string | null = registrationId
      if (regId === null) {
        // The browser says only that the family agreed; the server records when and from where
        const order = await createDraftRegistration({
          feisListingId: feisId,
          entries: requestedEntries,
          consentAccepted
        })
        if ('error' in order) {
          setError(order.error)
          return
        }
        regId = order.registrationId
        setRegistrationId(regId)
        setHoldExpiresAt(order.holdExpiresAt)
        setOrderBreakdown(order.breakdown)
        setEditingId(null)
        // Submit priced the order afresh. If that isn't the total the Pay button showed (a late
        // tier started, or the organiser changed a fee, while the page was open), the held order
        // and its receipt keep Submit's price, and the family presses Pay again to pay it
        if (order.totalCents !== totalCents) {
          setError(
            `Your total is now ${formatCents(order.totalCents)}. ` +
              'Fees changed since you opened this page (for example, late fees started). ' +
              'Check the receipt, then press Pay to continue.'
          )
          return
        }
      }

      const payment = await createCheckoutSession(regId)
      switch (payment.kind) {
        case 'redirect':
          leaving = true
          window.location.href = payment.url
          return
        case 'paid':
        case 'review':
        case 'checking':
          // Stripe has, or may have, the money: the success page says what happens next
          leaving = true
          window.location.href = successHref
          return
        case 'start_again':
          startAgain(payment.message)
          return
        default:
          // blocked, try_again or error: the order stays as it is
          setError(payment.message)
      }
    } catch (err) {
      console.error('Payment failed to start:', err)
      setError('The payment page could not be opened. Check your connection and try again.')
    } finally {
      // Stay busy while the browser leaves, so a second click can't start anything
      if (!leaving) setLoading(false)
    }
  }

  async function handleChangeEntries() {
    if (!registrationId) return
    setError(null)
    setLoading(true)
    let leaving = false
    try {
      // A submitted order never changes: cancel it, keep the cart, and Pay submits a new one
      const result = await cancelRegistration(registrationId)
      switch (result.kind) {
        case 'cancelled':
          setRegistrationId(null)
          setHoldExpiresAt(null)
          setOrderBreakdown(null)
          setPaymentStarted(false)
          return
        case 'paid':
        case 'review':
        case 'checking':
          // The checkout was paid after all, or may have been
          leaving = true
          window.location.href = successHref
          return
        default:
          // try_again or error: the order stays as it is
          setError(result.message)
      }
    } catch (err) {
      console.error('Failed to reopen entries:', err)
      setError('Your entries could not be reopened. Check your connection and try again.')
    } finally {
      if (!leaving) setLoading(false)
    }
  }

  const activeLateTier = feeSchedule
    ? getActiveLateTier(feeSchedule.late_fee_tiers, new Date())
    : null

  return (
    <div className="min-h-screen bg-[var(--color-feis-cream)] pb-24 lg:pb-0">
      <FeisCover
        listing={listing}
        lateFeeCents={activeLateTier?.fee_cents ?? null}
        links={[{ href: '/dashboard', label: 'My entries' }]}
        signOut
        back={{ href: `/feiseanna/${feisId}`, label: 'Back to feis details and fees' }}
      />

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
                const level = dancerLevelSummary(
                  dancer.dance_levels,
                  levels,
                  dancer.championship_status
                )
                return (
                  <DancerEntry
                    key={dancer.id}
                    dancer={dancer}
                    feisName={listing.name ?? ''}
                    details={[
                      `${level}, age ${age}`,
                      ...(dancer.school_name ? [dancer.school_name] : [])
                    ]}
                    number={numbers[dancer.id] ?? null}
                    eligible={eligibleByDancer[dancer.id] ?? []}
                    selected={(cart[dancer.id] ?? [])
                      .map((id) => competitionById.get(id))
                      .filter((c): c is FeisCompetition => c !== undefined)}
                    feeSchedule={feeSchedule}
                    editing={canEdit && editingId === dancer.id}
                    canEdit={canEdit}
                    lockedNote={
                      held
                        ? 'To add dances, choose Change entries under the family total.'
                        : undefined
                    }
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
            cardsHref={`/dashboard/numbers/${feisId}`}
          />
        ) : deadline.closed && !held ? (
          <aside className="feis-receipt px-[18px] py-5">
            <h2 className="text-[22px] font-extrabold [font-stretch:75%]">Entries are closed</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This feis isn&apos;t taking entries any more.
              {listing.contact_email
                ? ` To ask about a late entry, email ${listing.contact_email}.`
                : ''}
            </p>
          </aside>
        ) : !feeSchedule ? (
          <aside className="feis-receipt px-[18px] py-5">
            <h2 className="text-[22px] font-extrabold [font-stretch:75%]">Fees not set yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The organiser hasn&apos;t finished setting the fees, so entries can&apos;t be paid
              yet.
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

      {!paid && dancesChosen > 0 && !receiptVisible && (
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
