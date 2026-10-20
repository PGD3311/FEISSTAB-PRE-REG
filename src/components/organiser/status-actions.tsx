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
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false)

  function handleTransition(to: ListingStatus) {
    setError(null)
    startTransition(async () => {
      try {
        const result = await transitionListingStatus(listingId, to)
        if ('error' in result) {
          setError(result.error + (result.blocks ? ' ' + result.blocks.join(' ') : ''))
          return
        }
        setConfirmingWithdraw(false)
        router.refresh()
      } catch (err) {
        console.error('Failed to change the feis status:', err)
        setError('The change could not be saved. Check your connection and try again.')
      }
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

  if (status === 'pending_review') {
    return (
      <div>
        {confirmingWithdraw ? (
          <div className="max-w-xl border-l-4 border-[var(--color-feis-orange)] bg-white px-4 py-3">
            <p className="text-sm">
              Withdraw this feis from review? It goes back to a draft so you can change it, and
              you&apos;ll need to submit it again.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleTransition('draft')}
                disabled={isPending}
                className="feis-btn feis-btn-ink"
              >
                {isPending ? 'Withdrawing…' : 'Yes, withdraw it'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingWithdraw(false)}
                disabled={isPending}
                className="feis-btn feis-btn-outline"
              >
                Keep it waiting
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setError(null)
              setConfirmingWithdraw(true)
            }}
            className="feis-btn feis-btn-outline"
          >
            Withdraw
          </button>
        )}
        {errorBanner}
      </div>
    )
  }

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
