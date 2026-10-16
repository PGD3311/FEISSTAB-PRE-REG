'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { launchFeisDay } from '@/app/organiser/feiseanna/actions'

interface LaunchButtonProps {
  listingId: string
  disabled: boolean
}

function CountLine({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="flex items-baseline gap-1.5 py-0.5">
      <span className="text-sm">{label}</span>
      <span className="feis-leader" />
      <span className="feis-narrow text-[28px] leading-none tabular-nums">{value ?? 0}</span>
    </div>
  )
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
        registrationsCreated: res.registrationsCreated
      })
      setShowConfirm(false)
      router.refresh()
    })
  }

  if (result && result.eventId && !result.error) {
    return (
      <section className="feis-receipt max-w-md px-[18px] pt-5 pb-[18px]" role="status">
        <span className="inline-block rounded-[2px] bg-[var(--color-feis-green)] px-1.5 py-0.5 text-xs font-bold text-white">
          Launched
        </span>
        <h2 className="feis-display mt-2 text-[22px]">Feis day is live</h2>
        <p className="mb-3 text-[13px] text-muted-foreground">Sent to RunFeis for the day</p>
        <CountLine label="Competitions" value={result.competitionsCreated} />
        <CountLine label="Dancers" value={result.dancersCreated} />
        <CountLine label="Entries" value={result.registrationsCreated} />
        <p className="mt-3 border-t border-[#E2DCCD] pt-2.5 text-[13px] text-muted-foreground">
          Feis-day event ID <code className="font-mono text-xs">{result.eventId}</code>
        </p>
      </section>
    )
  }

  return (
    <div>
      {result?.error && (
        <p
          role="alert"
          className="mb-4 border-l-4 border-destructive bg-white px-4 py-3 text-sm text-destructive"
        >
          {result.error}
        </p>
      )}

      {!showConfirm ? (
        <div>
          <button
            type="button"
            onClick={() => setShowConfirm(true)}
            disabled={disabled || isPending}
            className="feis-btn feis-btn-primary px-6 py-3 text-base"
          >
            Launch feis day
          </button>
          {disabled && (
            <p className="mt-2 text-[13px] text-muted-foreground">
              Every item on the checklist needs a tick before you can launch.
            </p>
          )}
        </div>
      ) : (
        <div className="border-l-4 border-[var(--color-feis-orange)] bg-[var(--color-feis-orange-light)] px-5 py-4">
          <h3 className="feis-display text-[20px]">Launch feis day now?</h3>
          <p className="mt-1 mb-4 max-w-[60ch] text-sm text-[var(--color-feis-orange-ink)]">
            This can&apos;t be undone. The paid entries are sent to RunFeis for the day, and this
            feis can no longer be changed here.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleLaunch}
              disabled={isPending}
              className="feis-btn feis-btn-primary"
            >
              {isPending ? 'Launching…' : 'Yes, launch feis day'}
            </button>
            <button
              type="button"
              onClick={() => setShowConfirm(false)}
              disabled={isPending}
              className="feis-btn feis-btn-outline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
