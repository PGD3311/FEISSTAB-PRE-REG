'use client'

import { useState } from 'react'
import Link from 'next/link'
import { competitionFeeCents } from '@/lib/engine/fee-calculator'
import { groupForEntryForm } from '@/lib/entry-display'
import { formatCents } from '@/lib/format'
import { NumberCard } from '@/components/registration/number-card'
import type {
  Dancer,
  EligibleCompetition,
  FeeSchedule,
  FeisCompetition
} from '@/lib/types/feis-listing'

interface DancerEntryProps {
  dancer: Dancer
  feisName: string
  details: string[]
  number: number | null
  eligible: EligibleCompetition[]
  selected: FeisCompetition[]
  feeSchedule: FeeSchedule | null
  editing: boolean
  canEdit: boolean
  onEdit: () => void
  onDone: () => void
  onToggle: (competitionId: string) => void
}

function competitionName(comp: FeisCompetition): string {
  return comp.competition_type === 'solo' && comp.dance_label ? comp.dance_label : comp.display_name
}

/** One dancer: their number card, with the sticker of chosen dances (or the entry form) beside it. */
export function DancerEntry({
  dancer,
  feisName,
  details,
  number,
  eligible,
  selected,
  feeSchedule,
  editing,
  canEdit,
  onEdit,
  onDone,
  onToggle
}: DancerEntryProps) {
  const [showAll, setShowAll] = useState(false)
  const selectedIds = new Set(selected.map((c) => c.id))
  const eligibleCount = eligible.filter((e) => e.eligible).length
  const visible = showAll ? eligible : eligible.filter((e) => e.eligible || selectedIds.has(e.competition.id))
  const groups = groupForEntryForm(visible)
  const first = dancer.first_name

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[190px_minmax(0,1fr)]">
      <NumberCard
        feisName={feisName}
        number={number}
        name={`${dancer.first_name} ${dancer.last_name}`}
        details={details}
        showPendingNote={selected.length > 0}
      />

      {editing ? (
        <div className="feis-entry-form mx-2.5 self-start rounded-b border-t-0 sm:mx-0 sm:my-3.5 sm:rounded-r sm:rounded-bl-none sm:border-t-[1.5px] sm:border-l-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3 pb-2">
            <b className="text-base [font-stretch:80%]">Choose {first}&apos;s dances</b>
            <span className="text-sm text-muted-foreground">
              Only dances {first} can enter are listed
            </span>
          </div>

          {eligibleCount === 0 && !showAll && (
            <p className="border-t-[1.5px] border-[var(--color-feis-charcoal)] px-4 py-3 text-sm text-muted-foreground">
              No dances at this feis match {first}&apos;s age and levels.{' '}
              <Link href={`/dashboard/dancers/${dancer.id}`} className="font-semibold text-primary underline">
                Check {first}&apos;s levels
              </Link>
            </p>
          )}

          {groups.map((group) => (
            <fieldset key={group.label}>
              <legend className="w-full border-t-[1.5px] border-[var(--color-feis-charcoal)] px-4 pt-2 pb-1 text-[12.5px] font-bold text-muted-foreground">
                {group.label}
              </legend>
              {group.items.map(({ competition, eligible: canEnter, reason }) => {
                const checked = selectedIds.has(competition.id)
                return (
                  <label
                    key={competition.id}
                    className={`grid cursor-pointer grid-cols-[22px_56px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-[#E2DCCD] px-4 py-2 focus-within:outline-3 focus-within:outline-[var(--color-feis-gold)] sm:grid-cols-[22px_64px_minmax(0,1fr)_auto] ${
                      checked ? 'bg-[var(--color-feis-green-light)]' : ''
                    } ${canEnter ? '' : 'cursor-default text-muted-foreground'}`}
                  >
                    <input
                      type="checkbox"
                      className="feis-tick"
                      checked={checked}
                      disabled={!canEnter && !checked}
                      onChange={() => onToggle(competition.id)}
                    />
                    <span className="feis-narrow text-[17px]">{competition.display_code ?? ''}</span>
                    <span className="min-w-0">
                      {competitionName(competition)}
                      {!canEnter && <span className="block text-xs">{reason}</span>}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {feeSchedule ? formatCents(competitionFeeCents(competition, feeSchedule)) : ''}
                    </span>
                  </label>
                )
              })}
            </fieldset>
          ))}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t-[1.5px] border-[var(--color-feis-charcoal)] px-4 py-2.5">
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              {showAll ? `Hide dances ${first} can't enter` : `Show dances ${first} can't enter`}
            </button>
            <button
              type="button"
              onClick={onDone}
              className="rounded-[3px] bg-[var(--color-feis-charcoal)] px-5 py-2 text-sm font-bold text-white focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-feis-gold)]"
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="feis-sticker mx-2.5 grid content-start self-start gap-2.5 rounded-b border-t-0 px-4 py-3.5 sm:mx-0 sm:my-3.5 sm:rounded-r sm:rounded-bl-none sm:border-t sm:border-l-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2.5">
            <b className="text-base [font-stretch:80%]">
              {selected.length === 0
                ? 'Not entered'
                : `${selected.length} ${selected.length === 1 ? 'dance' : 'dances'}`}
            </b>
            {canEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="text-sm font-bold text-primary underline underline-offset-[3px] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-feis-gold)]"
              >
                {selected.length === 0 ? `Enter ${first}` : 'Change'}
              </button>
            )}
          </div>
          {selected.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
              {selected.map((comp) => (
                <li key={comp.id}>
                  <span className="feis-narrow block text-xl leading-tight">
                    {comp.display_code ?? competitionName(comp)}
                  </span>
                  {comp.display_code && (
                    <span className="block text-[11.5px] text-muted-foreground">
                      {competitionName(comp)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
