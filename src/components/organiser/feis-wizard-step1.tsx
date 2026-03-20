'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import type { FeisListing } from '@/lib/types/feis-listing'
import { updateListingDetails } from '@/app/organiser/feiseanna/actions'

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
  { value: 'America/Toronto', label: 'Eastern (Toronto)' },
  { value: 'Europe/Dublin', label: 'Ireland (Dublin)' },
  { value: 'Europe/London', label: 'United Kingdom (London)' },
  { value: 'Australia/Sydney', label: 'Australia (Sydney)' },
] as const

function detectTimezone(): string {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
    const match = TIMEZONES.find((tz) => tz.value === detected)
    return match ? detected : 'America/New_York'
  } catch {
    return 'America/New_York'
  }
}

interface FeisWizardStep1Props {
  listing: FeisListing
  onNext: () => void
}

export function FeisWizardStep1({ listing, onNext }: FeisWizardStep1Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [isMultiDay, setIsMultiDay] = useState(!!listing.end_date)

  const isExisting = !!listing.id

  const defaultTimezone =
    listing.timezone || detectTimezone()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const form = e.currentTarget
    const formData = new FormData(form)

    // Clear end_date if not multi-day
    if (!isMultiDay) {
      formData.delete('end_date')
    }

    startTransition(async () => {
      const result = await updateListingDetails(listing.id, formData)
      if ('error' in result) {
        setError(result.error as string)
        return
      }
      router.refresh()
      onNext()
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
        {/* Feis Name */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Basic Information</h2>

          <div>
            <label
              htmlFor="name"
              className="mb-1.5 block text-sm font-medium"
            >
              Feis Name <span className="text-muted-foreground">*</span>
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              defaultValue={listing.name ?? ''}
              placeholder="e.g. Emerald Isle Feis 2027"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        {/* Dates */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Date &amp; Location</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="feis_date"
                className="mb-1.5 block text-sm font-medium"
              >
                Feis Date <span className="text-muted-foreground">*</span>
              </label>
              <input
                id="feis_date"
                name="feis_date"
                type="date"
                required
                defaultValue={listing.feis_date ?? ''}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="flex items-end gap-3">
              <label className="flex items-center gap-2 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={isMultiDay}
                  onChange={(e) => setIsMultiDay(e.target.checked)}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                Multi-day event
              </label>
            </div>
          </div>

          {isMultiDay && (
            <div className="max-w-xs">
              <label
                htmlFor="end_date"
                className="mb-1.5 block text-sm font-medium"
              >
                End Date
              </label>
              <input
                id="end_date"
                name="end_date"
                type="date"
                defaultValue={listing.end_date ?? ''}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          )}

          <div>
            <label
              htmlFor="venue_name"
              className="mb-1.5 block text-sm font-medium"
            >
              Venue Name <span className="text-muted-foreground">*</span>
            </label>
            <input
              id="venue_name"
              name="venue_name"
              type="text"
              required
              defaultValue={listing.venue_name ?? ''}
              placeholder="e.g. Boston Convention Center"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div>
            <label
              htmlFor="venue_address"
              className="mb-1.5 block text-sm font-medium"
            >
              Venue Address
            </label>
            <input
              id="venue_address"
              name="venue_address"
              type="text"
              defaultValue={listing.venue_address ?? ''}
              placeholder="Full address (optional)"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="max-w-xs">
            <label
              htmlFor="timezone"
              className="mb-1.5 block text-sm font-medium"
            >
              Timezone <span className="text-muted-foreground">*</span>
            </label>
            <select
              id="timezone"
              name="timezone"
              required
              defaultValue={defaultTimezone}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Contact */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Contact Information</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="contact_email"
                className="mb-1.5 block text-sm font-medium"
              >
                Contact Email{' '}
                <span className="text-muted-foreground">*</span>
              </label>
              <input
                id="contact_email"
                name="contact_email"
                type="email"
                required
                defaultValue={listing.contact_email ?? ''}
                placeholder="organiser@example.com"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div>
              <label
                htmlFor="contact_phone"
                className="mb-1.5 block text-sm font-medium"
              >
                Contact Phone
              </label>
              <input
                id="contact_phone"
                name="contact_phone"
                type="tel"
                defaultValue={listing.contact_phone ?? ''}
                placeholder="(555) 123-4567"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          {/* Privacy Policy URL — grouped with contact info */}
          <div>
            <label
              htmlFor="privacy_policy_url"
              className="mb-1.5 block text-sm font-medium"
            >
              Privacy Policy URL{' '}
              <span className="text-destructive">*</span>
            </label>
            <input
              id="privacy_policy_url"
              name="privacy_policy_url"
              type="url"
              defaultValue={listing.privacy_policy_url ?? ''}
              placeholder="https://example.com/privacy"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Required to publish. Link to your privacy policy (e.g.
              https://example.com/privacy)
            </p>
          </div>
        </div>

        {/* Description */}
        <div>
          <label
            htmlFor="description"
            className="mb-1.5 block text-sm font-medium"
          >
            Description
          </label>
          <textarea
            id="description"
            name="description"
            rows={3}
            defaultValue={listing.description ?? ''}
            placeholder="Brief description shown to parents (optional)"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {/* Submit */}
      <div className="mt-8">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-feis-green-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPending
            ? 'Saving...'
            : isExisting
              ? 'Save & Continue'
              : 'Create Draft & Continue'}
        </button>
      </div>
    </form>
  )
}
