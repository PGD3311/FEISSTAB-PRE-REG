'use client'

import { useState, useTransition } from 'react'

import { cloneFeisAndRedirect } from '@/app/organiser/feiseanna/actions'
import type { ListingStatus } from '@/lib/types/feis-listing'

interface ClonePickerListing {
  id: string
  name: string
  feis_date: string
  status: ListingStatus
}

interface ClonePickerProps {
  listings: ClonePickerListing[]
}

function formatDate(dateString: string): string {
  const date = new Date(dateString + 'T00:00:00')
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const statusStyles: Record<ListingStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  open: 'bg-secondary text-primary',
  closed: 'bg-feis-orange-light text-feis-orange',
  launched: 'bg-primary text-primary-foreground',
}

export function ClonePicker({ listings }: ClonePickerProps) {
  const [isPending, startTransition] = useTransition()
  const [cloningId, setCloningId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleClone(sourceId: string) {
    setError(null)
    setCloningId(sourceId)
    startTransition(async () => {
      const result = await cloneFeisAndRedirect(sourceId)
      if (result && 'error' in result && typeof result.error === 'string') {
        setError(result.error)
        setCloningId(null)
      }
    })
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {listings.map((listing) => (
          <button
            key={listing.id}
            type="button"
            onClick={() => handleClone(listing.id)}
            disabled={isPending}
            className="feis-card flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {listing.name}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatDate(listing.feis_date)}
              </p>
            </div>
            <div className="ml-3 flex items-center gap-2">
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusStyles[listing.status as ListingStatus]}`}
              >
                {listing.status}
              </span>
              {cloningId === listing.id && isPending && (
                <span className="text-xs text-muted-foreground">
                  Cloning...
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
