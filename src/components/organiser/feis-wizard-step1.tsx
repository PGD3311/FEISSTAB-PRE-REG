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
  { value: 'Australia/Sydney', label: 'Australia (Sydney)' }
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

  const defaultTimezone = listing.timezone || detectTimezone()

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
    <form onSubmit={handleSubmit} className="max-w-2xl">
      {error && (
        <p
          role="alert"
          className="mb-6 border-l-4 border-destructive bg-white px-4 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <div className="feis-card divide-y divide-[#E2DCCD]">
        <section className="space-y-4 px-5 py-5 sm:px-6">
          <h2 className="feis-display text-[22px]">The feis</h2>

          <div>
            <label htmlFor="name" className="feis-label">
              Feis name <span className="text-muted-foreground">*</span>
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              defaultValue={listing.name ?? ''}
              placeholder="e.g. Emerald Isle Feis 2027"
              className="feis-input"
            />
          </div>

          <div>
            <label htmlFor="description" className="feis-label">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              rows={3}
              defaultValue={listing.description ?? ''}
              placeholder="A few lines for parents (optional)"
              className="feis-input"
            />
          </div>
        </section>

        <section className="space-y-4 px-5 py-5 sm:px-6">
          <h2 className="feis-display text-[22px]">Date and venue</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="feis_date" className="feis-label">
                Feis date <span className="text-muted-foreground">*</span>
              </label>
              <input
                id="feis_date"
                name="feis_date"
                type="date"
                required
                defaultValue={listing.feis_date ?? ''}
                className="feis-input"
              />
            </div>

            <div className="flex items-end">
              <label className="flex items-center gap-2 py-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={isMultiDay}
                  onChange={(e) => setIsMultiDay(e.target.checked)}
                  className="h-4 w-4 accent-[var(--color-feis-green)]"
                />
                The feis runs over more than one day
              </label>
            </div>
          </div>

          {isMultiDay && (
            <div className="sm:max-w-[calc(50%-0.5rem)]">
              <label htmlFor="end_date" className="feis-label">
                Last day
              </label>
              <input
                id="end_date"
                name="end_date"
                type="date"
                defaultValue={listing.end_date ?? ''}
                className="feis-input"
              />
            </div>
          )}

          <div>
            <label htmlFor="venue_name" className="feis-label">
              Venue name <span className="text-muted-foreground">*</span>
            </label>
            <input
              id="venue_name"
              name="venue_name"
              type="text"
              required
              defaultValue={listing.venue_name ?? ''}
              placeholder="e.g. Boston Convention Center"
              className="feis-input"
            />
          </div>

          <div>
            <label htmlFor="venue_address" className="feis-label">
              Venue address
            </label>
            <input
              id="venue_address"
              name="venue_address"
              type="text"
              defaultValue={listing.venue_address ?? ''}
              placeholder="Full address (optional)"
              className="feis-input"
            />
          </div>

          <div className="sm:max-w-[calc(50%-0.5rem)]">
            <label htmlFor="timezone" className="feis-label">
              Time zone <span className="text-muted-foreground">*</span>
            </label>
            <select
              id="timezone"
              name="timezone"
              required
              defaultValue={defaultTimezone}
              className="feis-input"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="space-y-4 px-5 py-5 sm:px-6">
          <h2 className="feis-display text-[22px]">Contact</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="contact_email" className="feis-label">
                Contact email <span className="text-muted-foreground">*</span>
              </label>
              <input
                id="contact_email"
                name="contact_email"
                type="email"
                required
                defaultValue={listing.contact_email ?? ''}
                placeholder="organiser@example.com"
                className="feis-input"
              />
            </div>

            <div>
              <label htmlFor="contact_phone" className="feis-label">
                Contact phone
              </label>
              <input
                id="contact_phone"
                name="contact_phone"
                type="tel"
                defaultValue={listing.contact_phone ?? ''}
                placeholder="(555) 123-4567"
                className="feis-input"
              />
            </div>
          </div>

          <div>
            <label htmlFor="privacy_policy_url" className="feis-label">
              Privacy policy link
            </label>
            <input
              id="privacy_policy_url"
              name="privacy_policy_url"
              type="url"
              defaultValue={listing.privacy_policy_url ?? ''}
              placeholder="https://example.com/privacy"
              aria-describedby="privacy_policy_url-hint"
              className="feis-input"
            />
            <p id="privacy_policy_url-hint" className="mt-1 text-xs text-muted-foreground">
              Needed before you can publish. Parents see it when they register.
            </p>
          </div>
        </section>

        <section className="space-y-4 px-5 py-5 sm:px-6">
          <h2 className="feis-display text-[22px]">Public listing</h2>

          <div>
            <label htmlFor="website_url" className="feis-label">
              Feis website
            </label>
            <input
              id="website_url"
              name="website_url"
              type="url"
              defaultValue={listing.website_url ?? ''}
              placeholder="https://yourfeis.com"
              aria-describedby="website_url-hint"
              className="feis-input"
            />
            <p id="website_url-hint" className="mt-1 text-xs text-muted-foreground">
              Shown on the public listing so parents can find more information.
            </p>
          </div>

          <div>
            <label htmlFor="logo_url" className="feis-label">
              Logo image link
            </label>
            <input
              id="logo_url"
              name="logo_url"
              type="url"
              defaultValue={listing.logo_url ?? ''}
              placeholder="https://yourfeis.com/logo.png"
              aria-describedby="logo_url-hint"
              className="feis-input"
            />
            <p id="logo_url-hint" className="mt-1 text-xs text-muted-foreground">
              Shown next to your feis on the home page. A square image works best.
            </p>
          </div>
        </section>
      </div>

      <div className="mt-6">
        <button type="submit" disabled={isPending} className="feis-btn feis-btn-primary">
          {isPending ? 'Saving…' : isExisting ? 'Save and continue' : 'Create draft and continue'}
        </button>
      </div>
    </form>
  )
}
