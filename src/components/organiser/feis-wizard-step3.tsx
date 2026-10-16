'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { sortLateTiers } from '@/lib/format'
import { localDateString } from '@/lib/timezone'
import type { FeeSchedule } from '@/lib/types/feis-listing'
import { saveFeeSchedule } from '@/app/organiser/feiseanna/actions'

const FEE_FIELDS = [
  {
    name: 'event_fee',
    label: 'Event fee (per family)',
    hint: 'Usually $25 to $30',
    dbField: 'event_fee_cents' as const,
    required: true
  },
  {
    name: 'solo_fee',
    label: 'Solo dance fee (per dancer, per dance)',
    hint: 'Usually $13 to $15',
    dbField: 'solo_fee_cents' as const,
    required: true
  },
  {
    name: 'prelim_champ_fee',
    label: 'Prelim championship fee (per dancer)',
    hint: 'Usually $50 to $55',
    dbField: 'prelim_champ_fee_cents' as const,
    required: true
  },
  {
    name: 'open_champ_fee',
    label: 'Open championship fee (per dancer)',
    hint: 'Usually $60 to $65',
    dbField: 'open_champ_fee_cents' as const,
    required: true
  },
  {
    name: 'family_cap',
    label: 'Competition entry max (per family)',
    hint: 'Most a family pays in entry fees. The event fee and late fees are added on top. Leave blank for no max.',
    dbField: 'family_cap_cents' as const,
    required: false
  },
  {
    name: 'day_of_surcharge',
    label: 'Day-of surcharge (per dancer)',
    hint: 'Usually $50',
    dbField: 'day_of_surcharge_cents' as const,
    required: true
  }
] as const

const MAX_LATE_TIERS = 4

interface TierRow {
  key: number
  date: string
  fee: string
  family_max: string
}

function centsToDollars(cents: number | null): string {
  if (cents === null || cents === undefined) return ''
  return (cents / 100).toFixed(2)
}

function DollarInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
        $
      </span>
      <input
        type="number"
        min="0"
        step="0.01"
        placeholder="0.00"
        className="feis-input pl-7 tabular-nums"
        {...props}
      />
    </div>
  )
}

interface FeisWizardStep3Props {
  listingId: string
  feeSchedule: FeeSchedule | null
  timeZone: string
  onNext: () => void
  onBack: () => void
}

export function FeisWizardStep3({
  listingId,
  feeSchedule,
  timeZone,
  onNext,
  onBack
}: FeisWizardStep3Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [tiers, setTiers] = useState<TierRow[]>(() =>
    sortLateTiers(feeSchedule?.late_fee_tiers ?? []).map((tier, i) => ({
      key: i,
      date: localDateString(tier.starts_at, timeZone),
      fee: centsToDollars(tier.fee_cents),
      family_max: centsToDollars(tier.family_max_cents)
    }))
  )

  function updateTier(key: number, field: 'date' | 'fee' | 'family_max', value: string) {
    setTiers((prev) => prev.map((t) => (t.key === key ? { ...t, [field]: value } : t)))
  }

  function addTier() {
    setTiers((prev) => [
      ...prev,
      { key: Math.max(-1, ...prev.map((t) => t.key)) + 1, date: '', fee: '', family_max: '' }
    ])
  }

  function removeTier(key: number) {
    setTiers((prev) => prev.filter((t) => t.key !== key))
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const formData = new FormData(e.currentTarget)
    formData.set(
      'late_fee_tiers',
      JSON.stringify(tiers.map(({ date, fee, family_max }) => ({ date, fee, family_max })))
    )

    startTransition(async () => {
      try {
        const result = await saveFeeSchedule(listingId, formData)
        if ('error' in result) {
          setError(result.error as string)
          return
        }
        router.refresh()
        onNext()
      } catch (err) {
        console.error('Failed to save fee schedule:', err)
        setError('An unexpected error occurred while saving.')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl">
      {error && (
        <p
          role="alert"
          className="mb-6 border-l-4 border-destructive bg-white px-4 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <div className="mb-4">
        <h2 className="feis-display text-[22px]">Fees</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          What parents pay when they register. All amounts are in dollars.
        </p>
      </div>

      <div className="feis-card divide-y divide-[#E2DCCD]">
        <section className="grid gap-5 px-5 py-5 sm:grid-cols-2 sm:px-6">
          {FEE_FIELDS.map((field) => {
            const existingValue = feeSchedule ? centsToDollars(feeSchedule[field.dbField]) : ''

            return (
              <div key={field.name}>
                <label htmlFor={field.name} className="feis-label">
                  {field.label}
                  {field.required && <span className="text-muted-foreground"> *</span>}
                </label>
                <DollarInput
                  id={field.name}
                  name={field.name}
                  required={field.required}
                  defaultValue={existingValue}
                  aria-describedby={`${field.name}-hint`}
                />
                <p id={`${field.name}-hint`} className="mt-1 text-xs text-muted-foreground">
                  {field.hint}
                </p>
              </div>
            )
          })}
        </section>

        <section className="px-5 py-5 sm:px-6">
          <h3 className="text-base font-extrabold [font-stretch:80%]">Late fees</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Each tier starts at midnight on its date and replaces the one before. The fee is charged
            once per dancer. Set a family max to cap what one family pays at that tier.
          </p>

          {tiers.length > 0 && (
            <div className="mt-4 border-y-[1.5px] border-[var(--color-feis-charcoal)]">
              <div className="hidden grid-cols-[1fr_1fr_1fr_4.5rem] gap-3 px-1 py-2 text-[12.5px] font-bold text-muted-foreground sm:grid">
                <span>Starts on</span>
                <span>Fee per dancer</span>
                <span>Family max (optional)</span>
                <span />
              </div>
              {tiers.map((tier, i) => (
                <div
                  key={tier.key}
                  className={`grid gap-3 px-1 py-3 sm:grid-cols-[1fr_1fr_1fr_4.5rem] sm:items-center sm:py-2 ${
                    i > 0 ? 'border-t border-[#E2DCCD]' : 'sm:border-t sm:border-[#E2DCCD]'
                  }`}
                >
                  <span className="feis-narrow text-[15px] sm:hidden">Tier {i + 1}</span>
                  <input
                    type="date"
                    required
                    aria-label={`Tier ${i + 1} start date`}
                    value={tier.date}
                    onChange={(e) => updateTier(tier.key, 'date', e.target.value)}
                    className="feis-input"
                  />
                  <DollarInput
                    required
                    aria-label={`Tier ${i + 1} fee per dancer`}
                    value={tier.fee}
                    onChange={(e) => updateTier(tier.key, 'fee', e.target.value)}
                  />
                  <DollarInput
                    aria-label={`Tier ${i + 1} family max`}
                    placeholder="No max"
                    value={tier.family_max}
                    onChange={(e) => updateTier(tier.key, 'family_max', e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => removeTier(tier.key)}
                    aria-label={`Remove tier ${i + 1}`}
                    className="justify-self-start text-sm text-muted-foreground underline underline-offset-2 hover:text-destructive sm:justify-self-end"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {tiers.length < MAX_LATE_TIERS && (
            <button type="button" onClick={addTier} className="feis-btn feis-btn-outline mt-4">
              Add a late fee tier
            </button>
          )}
        </section>
      </div>

      {/* Navigation */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} className="feis-btn feis-btn-outline">
          Back
        </button>
        <button type="submit" disabled={isPending} className="feis-btn feis-btn-primary">
          {isPending ? 'Saving…' : 'Save and continue'}
        </button>
      </div>
    </form>
  )
}
