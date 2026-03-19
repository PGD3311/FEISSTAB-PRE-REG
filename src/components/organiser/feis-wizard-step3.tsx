'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import type { FeeSchedule } from '@/lib/types/feis-listing'
import { saveFeeSchedule } from '@/app/organiser/feiseanna/actions'

const FEE_FIELDS = [
  {
    name: 'event_fee',
    label: 'Event Fee (per family)',
    hint: 'Typical: $25\u201330',
    dbField: 'event_fee_cents' as const,
    required: true,
  },
  {
    name: 'solo_fee',
    label: 'Solo Dance Fee (per dancer per dance)',
    hint: 'Typical: $13\u201315',
    dbField: 'solo_fee_cents' as const,
    required: true,
  },
  {
    name: 'prelim_champ_fee',
    label: 'Prelim Championship Fee (per dancer)',
    hint: 'Typical: $55',
    dbField: 'prelim_champ_fee_cents' as const,
    required: true,
  },
  {
    name: 'open_champ_fee',
    label: 'Open Championship Fee (per dancer)',
    hint: 'Typical: $60\u201365',
    dbField: 'open_champ_fee_cents' as const,
    required: true,
  },
  {
    name: 'family_cap',
    label: 'Family Cap (max total)',
    hint: 'Typical: $150\u2013175. Leave blank for no cap.',
    dbField: 'family_cap_cents' as const,
    required: false,
  },
  {
    name: 'late_fee',
    label: 'Late Fee (per dancer)',
    hint: 'Typical: $25',
    dbField: 'late_fee_cents' as const,
    required: true,
  },
  {
    name: 'day_of_surcharge',
    label: 'Day-of Surcharge (per dancer)',
    hint: 'Typical: $50',
    dbField: 'day_of_surcharge_cents' as const,
    required: true,
  },
] as const

function centsToDollars(cents: number | null): string {
  if (cents === null || cents === undefined) return ''
  return (cents / 100).toFixed(2)
}

interface FeisWizardStep3Props {
  listingId: string
  feeSchedule: FeeSchedule | null
  onNext: () => void
  onBack: () => void
}

export function FeisWizardStep3({
  listingId,
  feeSchedule,
  onNext,
  onBack,
}: FeisWizardStep3Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const formData = new FormData(e.currentTarget)

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
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    $
                  </span>
                  <input
                    id={field.name}
                    name={field.name}
                    type="number"
                    min="0"
                    step="0.01"
                    required={field.required}
                    defaultValue={existingValue}
                    placeholder="0.00"
                    className="w-full rounded-md border border-border bg-background py-2 pl-7 pr-3 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
            )
          })}
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
