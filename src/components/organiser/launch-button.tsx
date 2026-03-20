'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { launchFeisDay } from '@/app/organiser/feiseanna/actions'

interface LaunchButtonProps {
  listingId: string
  disabled: boolean
}

export function LaunchButton({ listingId, disabled }: LaunchButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showConfirm, setShowConfirm] = useState(false)
  const [result, setResult] = useState<{
    eventId?: string
    competitionsCreated?: number
    dancersCreated?: number
    registrationsCreated?: number
    error?: string
  } | null>(null)

  function handleLaunch() {
    startTransition(async () => {
      const res = await launchFeisDay(listingId)
      if ('error' in res) {
        setResult({ error: res.error })
        setShowConfirm(false)
        return
      }
      setResult({
        eventId: res.eventId ?? undefined,
        competitionsCreated: res.competitionsCreated,
        dancersCreated: res.dancersCreated,
        registrationsCreated: res.registrationsCreated,
      })
      setShowConfirm(false)
      router.refresh()
    })
  }

  if (result && result.eventId && !result.error) {
    return (
      <div className="feis-card border-primary/30 p-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="inline-block rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">
            Launched
          </span>
          <span className="text-lg font-semibold">Feis Day is Live</span>
        </div>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-muted-foreground">Competitions</dt>
            <dd className="text-xl font-semibold">{result.competitionsCreated}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Dancers</dt>
            <dd className="text-xl font-semibold">{result.dancersCreated}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Entries</dt>
            <dd className="text-xl font-semibold">{result.registrationsCreated}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm text-muted-foreground">
          Event ID: <code className="font-mono text-xs">{result.eventId}</code>
        </p>
      </div>
    )
  }

  return (
    <div>
      {result?.error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {result.error}
        </div>
      )}

      {!showConfirm ? (
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          disabled={disabled || isPending}
          className="rounded-md bg-primary px-6 py-3 text-base font-semibold text-primary-foreground hover:bg-feis-green-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Launch Feis Day
        </button>
      ) : (
        <div className="feis-card border-feis-orange/30 p-6">
          <h3 className="mb-2 text-lg font-semibold">Confirm Launch</h3>
          <p className="mb-4 text-sm text-muted-foreground">
            This action is irreversible. Registration data will be transferred to
            FeisTab for competition day and this listing will become read-only.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleLaunch}
              disabled={isPending}
              className="rounded-md bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-feis-green-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isPending ? 'Launching...' : 'Yes, Launch Feis Day'}
            </button>
            <button
              type="button"
              onClick={() => setShowConfirm(false)}
              disabled={isPending}
              className="rounded-md bg-muted px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted/80"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
