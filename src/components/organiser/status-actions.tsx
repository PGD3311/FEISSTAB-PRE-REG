'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

import type { ListingStatus } from '@/lib/types/feis-listing'
import { transitionListingStatus } from '@/app/organiser/feiseanna/actions'

interface StatusActionsProps {
  listingId: string
  status: ListingStatus
}

export function StatusActions({ listingId, status }: StatusActionsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleTransition(to: ListingStatus) {
    setError(null)
    startTransition(async () => {
      const result = await transitionListingStatus(listingId, to)
      if ('error' in result) {
        setError(result.error + (result.blocks ? ' ' + result.blocks.join(' ') : ''))
        return
      }
      router.refresh()
    })
  }

  if (status === 'draft') {
    return (
      <Link href={`/organiser/feiseanna/${listingId}/setup`} className="feis-btn feis-btn-primary">
        Carry on setting up
      </Link>
    )
  }

  const errorBanner = error && (
    <p
      role="alert"
      className="mt-3 max-w-xl border-l-4 border-destructive bg-white px-4 py-3 text-sm text-destructive"
    >
      {error}
    </p>
  )

  if (status === 'open' || status === 'closed') {
    const closing = status === 'open'
    return (
      <div>
        <button
          type="button"
          onClick={() => handleTransition(closing ? 'closed' : 'open')}
          disabled={isPending}
          className={closing ? 'feis-btn feis-btn-ink' : 'feis-btn feis-btn-outline'}
        >
          {closing
            ? isPending
              ? 'Closing entries…'
              : 'Close entries'
            : isPending
              ? 'Reopening entries…'
              : 'Reopen entries'}
        </button>
        {errorBanner}
      </div>
    )
  }

  // launched = terminal state, no status actions
  return null
}
