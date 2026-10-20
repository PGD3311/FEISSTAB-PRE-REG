'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { REGIONS } from '@/lib/regions'
import { saveOrganiserProfile } from '@/app/organiser/profile/actions'

interface OrganiserProfile {
  full_name: string
  organisation: string
  region: string
  phone: string | null
}

interface OrganiserProfileFormProps {
  profile: OrganiserProfile | null
  email: string
  next: string | null
}

export function OrganiserProfileForm({ profile, email, next }: OrganiserProfileFormProps) {
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
        const result = await saveOrganiserProfile(formData)
        if ('error' in result) {
          setError(result.error)
          return
        }
        if (next) {
          router.push(next)
        } else {
          setSaved(true)
          router.refresh()
        }
      } catch (err) {
        console.error('Failed to save organiser details:', err)
        setError('Your details could not be saved. Check your connection and try again.')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="feis-entry-form">
        <section className="grid gap-4 px-5 py-6 sm:grid-cols-2 sm:px-7">
          <div>
            <label htmlFor="full_name" className="feis-label">
              Your full name
            </label>
            <input
              id="full_name"
              name="full_name"
              type="text"
              required
              autoComplete="name"
              defaultValue={profile?.full_name ?? ''}
              className="feis-input"
            />
          </div>
          <div>
            <label htmlFor="organisation" className="feis-label">
              School or committee
            </label>
            <input
              id="organisation"
              name="organisation"
              type="text"
              required
              autoComplete="organization"
              defaultValue={profile?.organisation ?? ''}
              placeholder="e.g. Newport Feis Committee"
              className="feis-input"
            />
          </div>
          <div>
            <label htmlFor="region" className="feis-label">
              Region
            </label>
            <select
              id="region"
              name="region"
              required
              defaultValue={profile?.region ?? ''}
              className="feis-input"
            >
              <option value="" disabled>
                Choose your region
              </option>
              {REGIONS.map((region) => (
                <option key={region} value={region}>
                  {region}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="phone" className="feis-label">
              Phone <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              defaultValue={profile?.phone ?? ''}
              className="feis-input"
            />
          </div>
          <div className="sm:col-span-2">
            <span className="feis-label">Email</span>
            <p className="feis-input bg-[var(--color-feis-cream-dark)] text-muted-foreground">
              {email}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              RunFeis emails you here when your feis is approved or needs changes.
            </p>
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

      <div className="mt-6">
        <button type="submit" disabled={isPending} className="feis-btn feis-btn-primary">
          {isPending ? 'Saving…' : next ? 'Save and go back' : 'Save details'}
        </button>
      </div>
    </form>
  )
}
