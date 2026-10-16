'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import type { Household } from '@/lib/types/feis-listing'
import { saveHouseholdDetails } from '@/app/dashboard/actions'

function Field({
  name,
  label,
  defaultValue,
  required = true,
  autoComplete,
  type = 'text',
  className = ''
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
      <label htmlFor={name} className="feis-label">
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
        className="feis-input"
      />
    </div>
  )
}

export function HouseholdForm({
  household,
  email,
  next
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
        setError('Your details could not be saved. Check your connection and try again.')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="feis-entry-form">
        <section className="px-5 py-6 sm:px-7">
          <h2 className="feis-display text-[22px]">Parent or guardian</h2>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">
            The feis uses this to contact you about your entries. It is only shared with the
            organisers of feiseanna you enter.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              name="first_name"
              label="First name"
              defaultValue={household?.first_name ?? null}
              autoComplete="given-name"
            />
            <Field
              name="last_name"
              label="Last name"
              defaultValue={household?.last_name ?? null}
              autoComplete="family-name"
            />
            <div>
              <span className="feis-label">Email</span>
              <p className="feis-input bg-[var(--color-feis-cream-dark)] text-muted-foreground">
                {email}
              </p>
            </div>
            <Field
              name="phone"
              label="Mobile phone"
              type="tel"
              defaultValue={household?.phone ?? null}
              autoComplete="tel"
            />
          </div>
        </section>

        <section className="border-t-[1.5px] border-[var(--color-feis-charcoal)] px-5 py-6 sm:px-7">
          <h2 className="feis-display mb-4 text-[22px]">Address</h2>
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
            <Field
              name="city"
              label="City"
              defaultValue={household?.city ?? null}
              autoComplete="address-level2"
              className="sm:col-span-2"
            />
            <Field
              name="state_region"
              label="State"
              defaultValue={household?.state_region ?? null}
              autoComplete="address-level1"
              className="sm:col-span-2"
            />
            <Field
              name="postal_code"
              label="ZIP code"
              defaultValue={household?.postal_code ?? null}
              autoComplete="postal-code"
              className="sm:col-span-2"
            />
            <div className="sm:col-span-3">
              <label htmlFor="country" className="feis-label">
                Country
              </label>
              <select
                id="country"
                name="country"
                autoComplete="country"
                defaultValue={household?.country ?? 'US'}
                className="feis-input"
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
      </div>

      {error && (
        <p
          role="alert"
          className="mt-5 border-l-4 border-destructive bg-white px-4 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {saved && (
        <p
          role="status"
          className="mt-5 border-l-4 border-[var(--color-feis-green)] bg-[var(--color-feis-green-light)] px-4 py-3 text-sm font-semibold text-[var(--color-feis-green-700)]"
        >
          Your details are saved.
        </p>
      )}

      <button type="submit" disabled={isPending} className="feis-btn feis-btn-primary mt-6">
        {isPending ? 'Saving…' : next ? 'Save and continue' : 'Save details'}
      </button>
    </form>
  )
}
