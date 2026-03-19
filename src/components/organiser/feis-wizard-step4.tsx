'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'

import type { FeisListing } from '@/lib/types/feis-listing'
import { saveDeadlines } from '@/app/organiser/feiseanna/actions'

/** Compute a date string N days before a reference date. */
function daysBeforeDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}

/** Extract YYYY-MM-DD from a timestamptz string. */
function toDateInput(ts: string | null): string {
  if (!ts) return ''
  return ts.split('T')[0]
}

interface FeisWizardStep4Props {
  listing: FeisListing
  onNext: () => void
  onBack: () => void
}

export function FeisWizardStep4({
  listing,
  onNext,
  onBack,
}: FeisWizardStep4Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [enableLateReg, setEnableLateReg] = useState(
    !!listing.late_reg_closes_at
  )

  // Smart defaults based on feis_date
  const defaults = useMemo(() => {
    if (!listing.feis_date) {
      return { opens: '', closes: '', lateCloses: '' }
    }
    return {
      opens: daysBeforeDate(listing.feis_date, 56), // 8 weeks
      closes: daysBeforeDate(listing.feis_date, 14), // 2 weeks
      lateCloses: daysBeforeDate(listing.feis_date, 7), // 1 week
    }
  }, [listing.feis_date])

  // Controlled values for inline validation
  const [regOpens, setRegOpens] = useState(
    toDateInput(listing.reg_opens_at) || defaults.opens
  )
  const [regCloses, setRegCloses] = useState(
    toDateInput(listing.reg_closes_at) || defaults.closes
  )
  const [lateRegCloses, setLateRegCloses] = useState(
    toDateInput(listing.late_reg_closes_at) || defaults.lateCloses
  )

  // Inline validation
  const validationErrors = useMemo(() => {
    const errors: string[] = []
    if (regOpens && regCloses && regOpens >= regCloses) {
      errors.push('Opens must be before closes')
    }
    if (
      enableLateReg &&
      lateRegCloses &&
      regCloses &&
      lateRegCloses <= regCloses
    ) {
      errors.push('Late deadline must be after standard deadline')
    }
    if (regCloses && listing.feis_date && regCloses >= listing.feis_date) {
      errors.push('Registration must close before the event')
    }
    return errors
  }, [regOpens, regCloses, lateRegCloses, enableLateReg, listing.feis_date])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (validationErrors.length > 0) {
      setError('Please fix the date ordering issues below.')
      return
    }

    const formData = new FormData(e.currentTarget)

    // Remove late_reg_closes_at if not enabled
    if (!enableLateReg) {
      formData.delete('late_reg_closes_at')
    }

    startTransition(async () => {
      try {
        const result = await saveDeadlines(listing.id, formData)
        if ('error' in result) {
          setError(result.error as string)
          return
        }
        router.refresh()
        onNext()
      } catch (err) {
        console.error('Failed to save deadlines:', err)
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
          <h2 className="text-lg font-semibold">Deadlines &amp; Caps</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Set when registration opens and closes.
            {listing.feis_date && (
              <> Smart defaults based on feis date ({listing.feis_date}).</>
            )}
          </p>
        </div>

        {/* Registration Opens */}
        <div className="max-w-xs">
          <label
            htmlFor="reg_opens_at"
            className="mb-1.5 block text-sm font-medium"
          >
            Registration Opens{' '}
            <span className="text-muted-foreground">*</span>
          </label>
          <input
            id="reg_opens_at"
            name="reg_opens_at"
            type="date"
            required
            value={regOpens}
            onChange={(e) => setRegOpens(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Registration Closes */}
        <div className="max-w-xs">
          <label
            htmlFor="reg_closes_at"
            className="mb-1.5 block text-sm font-medium"
          >
            Registration Closes{' '}
            <span className="text-muted-foreground">*</span>
          </label>
          <input
            id="reg_closes_at"
            name="reg_closes_at"
            type="date"
            required
            value={regCloses}
            onChange={(e) => setRegCloses(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Late Registration Toggle + Date */}
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enableLateReg}
              onChange={(e) => setEnableLateReg(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            Enable late registration period
          </label>

          {enableLateReg && (
            <div className="max-w-xs">
              <label
                htmlFor="late_reg_closes_at"
                className="mb-1.5 block text-sm font-medium"
              >
                Late Registration Closes
              </label>
              <p className="mb-1.5 text-xs text-muted-foreground">
                Late fees apply after the standard deadline.
              </p>
              <input
                id="late_reg_closes_at"
                name="late_reg_closes_at"
                type="date"
                value={lateRegCloses}
                onChange={(e) => setLateRegCloses(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          )}
        </div>

        {/* Dancer Cap */}
        <div className="max-w-xs">
          <label
            htmlFor="dancer_cap"
            className="mb-1.5 block text-sm font-medium"
          >
            Overall Dancer Cap
          </label>
          <p className="mb-1.5 text-xs text-muted-foreground">
            Maximum number of dancers. Leave blank for unlimited.
          </p>
          <input
            id="dancer_cap"
            name="dancer_cap"
            type="number"
            min="1"
            defaultValue={listing.dancer_cap ?? ''}
            placeholder="Unlimited"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Inline validation errors */}
        {validationErrors.length > 0 && (
          <div className="space-y-1">
            {validationErrors.map((msg) => (
              <p key={msg} className="text-xs text-destructive">
                {msg}
              </p>
            ))}
          </div>
        )}
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
          disabled={isPending || validationErrors.length > 0}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-feis-green-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPending ? 'Saving...' : 'Save & Continue'}
        </button>
      </div>
    </form>
  )
}
