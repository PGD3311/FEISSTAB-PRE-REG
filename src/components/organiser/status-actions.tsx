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
      <Link
        href={`/organiser/feiseanna/${listingId}/setup`}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-feis-green-600"
      >
        Continue Setup
      </Link>
    )
  }

  if (status === 'open') {
    return (
      <button
        type="button"
        onClick={() => handleTransition('closed')}
        disabled={isPending}
        className="rounded-md bg-feis-orange-light px-4 py-2 text-sm font-medium text-feis-orange hover:bg-feis-orange/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isPending ? 'Closing...' : 'Close Registration'}
      </button>
    )
  }

  if (status === 'closed') {
    return (
      <button
        type="button"
        onClick={() => handleTransition('open')}
        disabled={isPending}
        className="rounded-md bg-secondary px-4 py-2 text-sm font-medium text-primary hover:bg-feis-green-light disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isPending ? 'Reopening...' : 'Reopen Registration'}
      </button>
    )
  }

  // launched = terminal state, no status actions
  return null
}
