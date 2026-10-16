'use client'

import { useTransition } from 'react'
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

  function handleTransition(to: ListingStatus) {
    startTransition(async () => {
      const result = await transitionListingStatus(listingId, to)
      if ('error' in result) {
        // For now, alert on error — a toast would be better in production
        alert(result.error + (result.blocks ? '\n' + result.blocks.join('\n') : ''))
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

  if (status === 'open') {
    return (
      <button
        type="button"
        onClick={() => handleTransition('closed')}
        disabled={isPending}
        className="feis-btn feis-btn-ink"
      >
        {isPending ? 'Closing entries…' : 'Close entries'}
      </button>
    )
  }

  if (status === 'closed') {
    return (
      <button
        type="button"
        onClick={() => handleTransition('open')}
        disabled={isPending}
        className="feis-btn feis-btn-outline"
      >
        {isPending ? 'Reopening entries…' : 'Reopen entries'}
      </button>
    )
  }

  // launched = terminal state, no status actions
  return null
}
