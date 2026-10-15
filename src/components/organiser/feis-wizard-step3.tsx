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
    label: 'Event Fee (per family)',
    hint: 'Typical: $25–30',
    dbField: 'event_fee_cents' as const,
    required: true,
  },
  {
    name: 'solo_fee',
    label: 'Solo Dance Fee (per dancer per dance)',
    hint: 'Typical: $13–15',
    dbField: 'solo_fee_cents' as const,
    required: true,
  },
  {
    name: 'prelim_champ_fee',
    label: 'Prelim Championship Fee (per dancer)',
    hint: 'Typical: $50–55',
    dbField: 'prelim_champ_fee_cents' as const,
    required: true,
  },
  {
    name: 'open_champ_fee',
    label: 'Open Championship Fee (per dancer)',
    hint: 'Typical: $60–65',
    dbField: 'open_champ_fee_cents' as const,
    required: true,
  },
  {
    name: 'family_cap',
    label: 'Competition Entry Max (per family)',
    hint: 'Most a family pays in entry fees. The event fee and late fees are added on top. Leave blank for no max.',
    dbField: 'family_cap_cents' as const,
    required: false,
  },
  {
    name: 'day_of_surcharge',
    label: 'Day-of Surcharge (per dancer)',
    hint: 'Typical: $50',
    dbField: 'day_of_surcharge_cents' as const,
    required: true,
  },
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

const inputClass =
  'w-full rounded-md border border-border bg-background py-2 pr-3 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring'

function DollarInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        $
      </span>
      <input
        type="number"
        min="0"
        step="0.01"
        placeholder="0.00"
        className={`${inputClass} pl-7`}
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
  onBack,
}: FeisWizardStep3Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [tiers, setTiers] = useState<TierRow[]>(() =>
    sortLateTiers(feeSchedule?.late_fee_tiers ?? []).map((tier, i) => ({
      key: i,
      date: localDateString(tier.starts_at, timeZone),
      fee: centsToDollars(tier.fee_cents),
      family_max: centsToDollars(tier.family_max_cents),
    }))
  )

  function updateTier(key: number, field: 'date' | 'fee' | 'family_max', value: string) {
    setTiers((prev) => prev.map((t) => (t.key === key ? { ...t, [field]: value } : t)))
  }

  function addTier() {
    setTiers((prev) => [
      ...prev,
      { key: Math.max(-1, ...prev.map((t) => t.key)) + 1, date: '', fee: '', family_max: '' },
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
    <form onSubmit={handleSubmit}>
      {error && (
        <div className="mb-6 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">Fee Schedule</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Set the fees parents will pay when registering. All amounts in
            dollars.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {FEE_FIELDS.map((field) => {
            const existingValue = feeSchedule
              ? centsToDollars(feeSchedule[field.dbField])
              : ''

            return (
              <div key={field.name}>
                <label
                  htmlFor={field.name}
                  className="mb-1.5 block text-sm font-medium"
                >
                  {field.label}
                  {field.required && (
                    <span className="text-muted-foreground"> *</span>
                  )}
                </label>
                <p className="mb-1.5 text-xs text-muted-foreground">
                  {field.hint}
                </p>
                <DollarInput
                  id={field.name}
                  name={field.name}
                  required={field.required}
                  defaultValue={existingValue}
                />
              </div>
            )
          })}
        </div>

        <div className="border-t border-border pt-6">
          <h3 className="text-sm font-semibold">Late Fees</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Each tier starts at midnight on its date and replaces the one before. The fee is
            charged once per dancer. Set a family max to cap what one family pays at that tier.
          </p>

          {tiers.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="hidden grid-cols-[1fr_1fr_1fr_auto] gap-3 text-xs font-medium text-muted-foreground sm:grid">
                <span>Starts on</span>
                <span>Fee per dancer</span>
                <span>Family max (optional)</span>
                <span className="w-16" />
              </div>
              {tiers.map((tier, i) => (
                <div
                  key={tier.key}
                  className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-center sm:border-0 sm:p-0"
                >
                  <input
                    type="date"
                    required
                    aria-label={`Tier ${i + 1} start date`}
                    value={tier.date}
                    onChange={(e) => updateTier(tier.key, 'date', e.target.value)}
                    className={`${inputClass} pl-3`}
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
                    className="w-16 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {tiers.length < MAX_LATE_TIERS && (
            <button
              type="button"
              onClick={addTier}
              className="mt-4 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              + Add late fee tier
            </button>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="mt-8 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-muted"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-feis-green-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPending ? 'Saving...' : 'Save & Continue'}
        </button>
      </div>
    </form>
  )
}
