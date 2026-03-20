'use client'

import { useState, useMemo } from 'react'
import { getEligibleCompetitions, calculateAgeOnDate } from '@/lib/engine/eligibility'
import { calculateFees } from '@/lib/engine/fee-calculator'
import type {
  Dancer,
  DancerDanceLevel,
  FeisCompetition,
  FeeSchedule,
  DancerProfile,
  Level,
  FeeEntry,
  EligibleCompetition
} from '@/lib/types/feis-listing'

interface Step2CartProps {
  selectedDancers: (Dancer & { dance_levels: DancerDanceLevel[] })[]
  competitions: FeisCompetition[]
  feeSchedule: FeeSchedule
  ageCutoffDate: Date
  levels: Level[]
  isLate: boolean
  onNext: (cart: Record<string, string[]>) => void
  onBack: () => void
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function buildDancerProfile(
  dancer: Dancer & { dance_levels: DancerDanceLevel[] }
): DancerProfile {
  const danceLevels: Record<string, string> = {}
  for (const dl of dancer.dance_levels) {
    danceLevels[dl.dance_key] = dl.level_key
  }
  return {
    dob: new Date(dancer.date_of_birth + 'T00:00:00'),
    gender: dancer.gender,
    championshipStatus: dancer.championship_status,
    danceLevels
  }
}

const COMPETITION_TYPE_ORDER = ['solo', 'championship', 'special', 'custom'] as const
const COMPETITION_TYPE_LABELS: Record<string, string> = {
  solo: 'Solo Dances',
  championship: 'Championships',
  special: 'Specials',
  custom: 'Other'
}

function CompetitionRow({
  eligible,
  selected,
  onToggle,
  feeSchedule
}: {
  eligible: EligibleCompetition
  selected: boolean
  onToggle: () => void
  feeSchedule: FeeSchedule
}) {
  const { competition } = eligible

  const feeCents =
    competition.fee_category === 'prelim_champ'
      ? feeSchedule.prelim_champ_fee_cents
      : competition.fee_category === 'open_champ'
        ? feeSchedule.open_champ_fee_cents
        : feeSchedule.solo_fee_cents

  return (
    <button
      onClick={eligible.eligible ? onToggle : undefined}
      disabled={!eligible.eligible}
      className={`flex w-full items-center justify-between rounded-md border px-4 py-3 text-left transition-colors ${
        !eligible.eligible
          ? 'cursor-default border-border bg-muted/30 opacity-60'
          : selected
            ? 'border-primary bg-[var(--color-feis-green-light)] ring-1 ring-primary/20'
            : 'border-border bg-white hover:border-primary/40 hover:bg-[var(--color-feis-green-light)]/30'
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
            !eligible.eligible
              ? 'border-muted-foreground/30'
              : selected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input'
          }`}
        >
          {selected && (
            <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{competition.display_name}</div>
          {!eligible.eligible && (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{eligible.reason}</div>
          )}
        </div>
      </div>
      <div className="ml-4 flex-shrink-0 font-mono text-sm text-muted-foreground">
        {formatCents(feeCents)}
      </div>
    </button>
  )
}

export function Step2Cart({
  selectedDancers,
  competitions,
  feeSchedule,
  ageCutoffDate,
  levels,
  isLate,
  onNext,
  onBack
}: Step2CartProps) {
  const [activeDancerIdx, setActiveDancerIdx] = useState(0)
  const [cart, setCart] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {}
    for (const d of selectedDancers) initial[d.id] = []
    return initial
  })
  const [showIneligible, setShowIneligible] = useState(false)

  const activeDancer = selectedDancers[activeDancerIdx]

  const eligibleMap = useMemo(() => {
    const map: Record<string, EligibleCompetition[]> = {}
    for (const dancer of selectedDancers) {
      const profile = buildDancerProfile(dancer)
      map[dancer.id] = getEligibleCompetitions(profile, competitions, ageCutoffDate, levels)
    }
    return map
  }, [selectedDancers, competitions, ageCutoffDate, levels])

  const activeEligible = eligibleMap[activeDancer.id] ?? []

  const visibleComps = showIneligible
    ? activeEligible
    : activeEligible.filter(e => e.eligible)

  const grouped = useMemo(() => {
    const groups: Record<string, EligibleCompetition[]> = {}
    for (const ec of visibleComps) {
      const type = ec.competition.competition_type
      if (!groups[type]) groups[type] = []
      groups[type].push(ec)
    }
    return groups
  }, [visibleComps])

  const feeBreakdown = useMemo(() => {
    const entries: FeeEntry[] = []
    for (const [dancerId, compIds] of Object.entries(cart)) {
      for (const compId of compIds) {
        const comp = competitions.find(c => c.id === compId)
        if (!comp) continue
        entries.push({
          dancer_id: dancerId,
          fee_category: comp.fee_category,
          is_late: isLate,
          is_day_of: false
        })
      }
    }
    if (entries.length === 0) return null
    return calculateFees(feeSchedule, entries)
  }, [cart, competitions, feeSchedule, isLate])

  const totalEntries = Object.values(cart).reduce((sum, ids) => sum + ids.length, 0)

  function toggleCompetition(competitionId: string) {
    setCart(prev => {
      const current = prev[activeDancer.id] ?? []
      const next = current.includes(competitionId)
        ? current.filter(id => id !== competitionId)
        : [...current, competitionId]
      return { ...prev, [activeDancer.id]: next }
    })
  }

  function handleNext() {
    onNext(cart)
  }

  const activeDancerAge = calculateAgeOnDate(
    new Date(activeDancer.date_of_birth + 'T00:00:00'),
    ageCutoffDate
  )

  return (
    <div>
      <h2 className="mb-1 text-xl font-semibold">Choose Competitions</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        {selectedDancers.length === 1
          ? 'Select competitions for your dancer.'
          : `Select competitions for each dancer.`}
      </p>

      {/* Dancer tab bar — only shown when >1 dancer */}
      {selectedDancers.length > 1 && (
        <div className="mb-6 flex gap-1 overflow-x-auto border-b border-border pb-0">
          {selectedDancers.map((dancer, idx) => {
            const entryCount = (cart[dancer.id] ?? []).length
            return (
              <button
                key={dancer.id}
                onClick={() => setActiveDancerIdx(idx)}
                className={`flex-shrink-0 rounded-t-md px-4 py-2 text-sm font-medium transition-colors ${
                  idx === activeDancerIdx
                    ? 'border border-b-white border-border bg-white text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {dancer.first_name}
                {entryCount > 0 && (
                  <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
                    {entryCount}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Active dancer info */}
      <div className="mb-4 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">
          {activeDancer.first_name} {activeDancer.last_name}
        </span>
        {' '}— Age {activeDancerAge} for this feis
        {activeDancer.championship_status !== 'none' && (
          <span className="ml-2 rounded bg-[var(--color-feis-gold)]/20 px-1.5 py-0.5 text-xs font-medium text-[var(--color-feis-charcoal)]">
            {activeDancer.championship_status === 'prelim' ? 'Prelim Champ' : 'Open Champ'}
          </span>
        )}
      </div>

      {/* Ineligible toggle */}
      <div className="mb-4 flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {activeEligible.filter(e => e.eligible).length} eligible competitions
        </div>
        <button
          onClick={() => setShowIneligible(prev => !prev)}
          className="text-xs font-medium text-primary hover:underline"
        >
          {showIneligible ? 'Hide ineligible' : 'Show all competitions (including ineligible)'}
        </button>
      </div>

      {/* Competition list grouped by type */}
      <div className="space-y-6">
        {COMPETITION_TYPE_ORDER.map(type => {
          const comps = grouped[type]
          if (!comps || comps.length === 0) return null
          return (
            <div key={type}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {COMPETITION_TYPE_LABELS[type]}
              </h3>
              <div className="space-y-1.5">
                {comps.map(ec => (
                  <CompetitionRow
                    key={ec.competition.id}
                    eligible={ec}
                    selected={(cart[activeDancer.id] ?? []).includes(ec.competition.id)}
                    onToggle={() => toggleCompetition(ec.competition.id)}
                    feeSchedule={feeSchedule}
                  />
                ))}
              </div>
            </div>
          )
        })}

        {visibleComps.length === 0 && (
          <div className="rounded-md border border-border bg-muted/20 px-6 py-8 text-center text-sm text-muted-foreground">
            No eligible competitions found for {activeDancer.first_name}.
          </div>
        )}
      </div>

      {/* Running total footer */}
      {feeBreakdown && (
        <div className="mt-6 rounded-md border border-border bg-[var(--color-feis-green-light)] p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {totalEntries} {totalEntries === 1 ? 'competition' : 'competitions'} selected
            </span>
            <span className="font-medium">{formatCents(feeBreakdown.subtotal_before_cap_cents)}</span>
          </div>
          {feeBreakdown.event_fee_cents > 0 && (
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Event fee (per family)</span>
              <span>{formatCents(feeBreakdown.event_fee_cents)}</span>
            </div>
          )}
          {isLate && (
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Late fee</span>
              <span>{formatCents(feeSchedule.late_fee_cents)} per dancer</span>
            </div>
          )}
          {feeBreakdown.family_cap_applied && (
            <div className="mt-2 text-xs text-[var(--color-feis-green)]">
              Family cap applied — you saved{' '}
              {formatCents(feeBreakdown.subtotal_before_cap_cents - feeBreakdown.grand_total_cents)}
            </div>
          )}
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <span className="font-semibold">Total</span>
            <span className="font-mono text-lg font-semibold">
              {formatCents(feeBreakdown.grand_total_cents)}
            </span>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="mt-8 flex justify-between">
        <button
          onClick={onBack}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
        >
          Back
        </button>
        <button
          onClick={handleNext}
          disabled={totalEntries === 0}
          className="rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-[var(--color-feis-green-600)] disabled:opacity-50"
        >
          Next: Review &amp; Pay
        </button>
      </div>
    </div>
  )
}
