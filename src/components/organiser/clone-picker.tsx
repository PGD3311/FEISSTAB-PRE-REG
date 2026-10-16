'use client'

import { useState, useTransition } from 'react'

import { cloneFeisAndRedirect } from '@/app/organiser/feiseanna/actions'
import { formatDate } from '@/lib/format'
import type { ListingStatus } from '@/lib/types/feis-listing'
import { ListingStatusTag } from '@/components/organiser/listing-status-tag'

interface ClonePickerListing {
  id: string
  name: string
  feis_date: string
  status: ListingStatus
}

interface ClonePickerProps {
  listings: ClonePickerListing[]
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
        <p
          role="alert"
          className="mb-4 border-l-4 border-destructive bg-white px-4 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <ul className="border-y-[1.5px] border-[var(--color-feis-charcoal)]">
        {listings.map((listing, i) => {
          const copying = cloningId === listing.id && isPending
          return (
            <li key={listing.id} className={i > 0 ? 'border-t border-[#E2DCCD]' : ''}>
              <button
                type="button"
                onClick={() => handleClone(listing.id)}
                disabled={isPending}
                className="flex w-full items-center justify-between gap-3 px-1 py-2.5 text-left hover:bg-[var(--color-feis-green-light)] focus-visible:outline-3 focus-visible:outline-offset-0 focus-visible:outline-[var(--color-feis-gold)] disabled:cursor-default disabled:opacity-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">
                    {listing.name || 'Untitled feis'}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-[13px] text-muted-foreground">
                    {formatDate(listing.feis_date, { month: 'short', fallback: 'No date' })}
                    <ListingStatusTag listing={{ status: listing.status as ListingStatus }} />
                  </span>
                </span>
                <span className="shrink-0 text-sm font-bold text-[var(--color-feis-green)] underline underline-offset-[3px]">
                  {copying ? 'Copying…' : 'Copy'}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
