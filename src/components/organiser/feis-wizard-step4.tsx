'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'

import { formatDate } from '@/lib/format'
import { localDateString } from '@/lib/timezone'
import type { FeisListing } from '@/lib/types/feis-listing'
import { saveDeadlines } from '@/app/organiser/feiseanna/actions'

/** Compute a date string N days before a reference date. */
function daysBeforeDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}

/** Extract YYYY-MM-DD from a timestamptz string. */
function toDateInput(ts: string | null, timeZone: string): string {
  if (!ts) return ''
  return localDateString(ts, timeZone)
}

interface FeisWizardStep4Props {
  listing: FeisListing
  onNext: () => void
  onBack: () => void
}

export function FeisWizardStep4({ listing, onNext, onBack }: FeisWizardStep4Props) {
  const timeZone = listing.timezone ?? 'America/New_York'
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [enableLateReg, setEnableLateReg] = useState(!!listing.late_reg_closes_at)

  // Smart defaults based on feis_date
  const defaults = useMemo(() => {
    if (!listing.feis_date) {
      return { opens: '', closes: '', lateCloses: '' }
    }
    return {
      opens: daysBeforeDate(listing.feis_date, 56), // 8 weeks
      closes: daysBeforeDate(listing.feis_date, 14), // 2 weeks
      lateCloses: daysBeforeDate(listing.feis_date, 7) // 1 week
    }
  }, [listing.feis_date])

  // Controlled values for inline validation
  const [regOpens, setRegOpens] = useState(
    toDateInput(listing.reg_opens_at, timeZone) || defaults.opens
  )
  const [regCloses, setRegCloses] = useState(
    toDateInput(listing.reg_closes_at, timeZone) || defaults.closes
  )
  const [lateRegCloses, setLateRegCloses] = useState(
    toDateInput(listing.late_reg_closes_at, timeZone) || defaults.lateCloses
  )

  // Inline validation
  const validationErrors = useMemo(() => {
    const errors: string[] = []
    if (regOpens && regCloses && regOpens >= regCloses) {
      errors.push('Registration must open before it closes')
    }
    if (enableLateReg && lateRegCloses && regCloses && lateRegCloses <= regCloses) {
      errors.push('Late registration must close after the standard deadline')
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
      setError('Some dates are in the wrong order. Fix them below, then save.')
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
        <h2 className="feis-display text-[22px]">Deadlines and dancer cap</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Set when registration opens and closes.
          {listing.feis_date && (
            <>
              {' '}
              The dates below are suggested from your feis date,{' '}
              {formatDate(listing.feis_date, { weekday: 'short', month: 'short' })}.
            </>
          )}
        </p>
      </div>

      <div className="feis-card divide-y divide-[#E2DCCD]">
        <section className="grid gap-4 px-5 py-5 sm:grid-cols-2 sm:px-6">
          <div>
            <label htmlFor="reg_opens_at" className="feis-label">
              Registration opens <span className="text-muted-foreground">*</span>
            </label>
            <input
              id="reg_opens_at"
              name="reg_opens_at"
              type="date"
              required
              value={regOpens}
              onChange={(e) => setRegOpens(e.target.value)}
              className="feis-input"
            />
          </div>

          <div>
            <label htmlFor="reg_closes_at" className="feis-label">
              Registration closes <span className="text-muted-foreground">*</span>
            </label>
            <input
              id="reg_closes_at"
              name="reg_closes_at"
              type="date"
              required
              value={regCloses}
              onChange={(e) => setRegCloses(e.target.value)}
              className="feis-input"
            />
          </div>
        </section>

        <section className="space-y-3 px-5 py-5 sm:px-6">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={enableLateReg}
              onChange={(e) => setEnableLateReg(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-feis-green)]"
            />
            Allow late registration
          </label>

          {enableLateReg && (
            <div className="sm:max-w-[calc(50%-0.5rem)]">
              <label htmlFor="late_reg_closes_at" className="feis-label">
                Late registration closes
              </label>
              <input
                id="late_reg_closes_at"
                name="late_reg_closes_at"
                type="date"
                value={lateRegCloses}
                onChange={(e) => setLateRegCloses(e.target.value)}
                aria-describedby="late_reg_closes_at-hint"
                className="feis-input"
              />
              <p id="late_reg_closes_at-hint" className="mt-1 text-xs text-muted-foreground">
                Late fees apply after the standard deadline.
              </p>
            </div>
          )}
        </section>

        <section className="px-5 py-5 sm:px-6">
          <div className="sm:max-w-[calc(50%-0.5rem)]">
            <label htmlFor="dancer_cap" className="feis-label">
              Dancer cap
            </label>
            <input
              id="dancer_cap"
              name="dancer_cap"
              type="number"
              min="1"
              defaultValue={listing.dancer_cap ?? ''}
              placeholder="No limit"
              aria-describedby="dancer_cap-hint"
              className="feis-input tabular-nums"
            />
            <p id="dancer_cap-hint" className="mt-1 text-xs text-muted-foreground">
              The most dancers who can register. Leave blank for no limit.
            </p>
          </div>
        </section>
      </div>

      {/* Inline validation errors */}
      {validationErrors.length > 0 && (
        <ul role="alert" className="mt-4 space-y-1 border-l-4 border-destructive pl-3">
          {validationErrors.map((msg) => (
            <li key={msg} className="text-sm text-destructive">
              {msg}
            </li>
          ))}
        </ul>
      )}

      {/* Navigation */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} className="feis-btn feis-btn-outline">
          Back
        </button>
        <button
          type="submit"
          disabled={isPending || validationErrors.length > 0}
          className="feis-btn feis-btn-primary"
        >
          {isPending ? 'Saving…' : 'Save and continue'}
        </button>
      </div>
    </form>
  )
}
