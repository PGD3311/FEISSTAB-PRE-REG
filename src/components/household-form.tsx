'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import type { Household } from '@/lib/types/feis-listing'
import { saveHouseholdDetails } from '@/app/dashboard/actions'

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring'

function Field({
  name,
  label,
  defaultValue,
  required = true,
  autoComplete,
  type = 'text',
  className = '',
}: {
  name: string
  label: string
  defaultValue: string | null
  required?: boolean
  autoComplete: string
  type?: string
  className?: string
}) {
  return (
    <div className={className}>
      <label htmlFor={name} className="mb-1 block text-sm font-medium">
        {label}
        {!required && <span className="font-normal text-muted-foreground"> (optional)</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        defaultValue={defaultValue ?? ''}
        className={inputClass}
      />
    </div>
  )
}

export function HouseholdForm({
  household,
  email,
  next,
}: {
  household: Partial<Household> | null
  email: string
  next: string | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      try {
        const result = await saveHouseholdDetails(formData)
        if ('error' in result) {
          setError(result.error ?? 'Failed to save')
          return
        }
        if (next) {
          router.push(next)
        } else {
          setSaved(true)
          router.refresh()
        }
      } catch (err) {
        console.error('Failed to save household details:', err)
        setError('An unexpected error occurred while saving.')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <section className="feis-card p-5">
        <h2 className="mb-1 text-base font-semibold">Parent or guardian</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          The feis uses this to contact you about your entries. It is only shared with the
          organisers of feiseanna you register for.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="first_name" label="First name" defaultValue={household?.first_name ?? null} autoComplete="given-name" />
          <Field name="last_name" label="Last name" defaultValue={household?.last_name ?? null} autoComplete="family-name" />
          <div>
            <span className="mb-1 block text-sm font-medium">Email</span>
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
              {email}
            </p>
          </div>
          <Field name="phone" label="Mobile phone" type="tel" defaultValue={household?.phone ?? null} autoComplete="tel" />
        </div>
      </section>

      <section className="feis-card p-5">
        <h2 className="mb-4 text-base font-semibold">Address</h2>
        <div className="grid gap-4 sm:grid-cols-6">
          <Field
            name="address_line1"
            label="Street address"
            defaultValue={household?.address_line1 ?? null}
            autoComplete="address-line1"
            className="sm:col-span-6"
          />
          <Field
            name="address_line2"
            label="Apartment, suite, etc."
            required={false}
            defaultValue={household?.address_line2 ?? null}
            autoComplete="address-line2"
            className="sm:col-span-6"
          />
          <Field name="city" label="City" defaultValue={household?.city ?? null} autoComplete="address-level2" className="sm:col-span-3" />
          <Field
            name="state_region"
            label="State / Province"
            defaultValue={household?.state_region ?? null}
            autoComplete="address-level1"
            className="sm:col-span-1"
          />
          <Field
            name="postal_code"
            label="ZIP / Postal code"
            defaultValue={household?.postal_code ?? null}
            autoComplete="postal-code"
            className="sm:col-span-2"
          />
          <div className="sm:col-span-3">
            <label htmlFor="country" className="mb-1 block text-sm font-medium">
              Country
            </label>
            <select
              id="country"
              name="country"
              autoComplete="country"
              defaultValue={household?.country ?? 'US'}
              className={inputClass}
            >
              <option value="US">United States</option>
              <option value="CA">Canada</option>
              <option value="IE">Ireland</option>
              <option value="GB">United Kingdom</option>
              <option value="AU">Australia</option>
              <option value="NZ">New Zealand</option>
            </select>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {saved && (
        <div role="status" className="rounded-md bg-secondary px-4 py-3 text-sm text-primary">
          Your details are saved.
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-[var(--color-feis-green-600)] disabled:opacity-40"
      >
        {isPending ? 'Saving...' : next ? 'Save and continue' : 'Save details'}
      </button>
    </form>
  )
}
