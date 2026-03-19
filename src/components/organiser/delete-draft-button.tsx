'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { deleteDraftListing } from '@/app/organiser/feiseanna/actions'

interface DeleteDraftButtonProps {
  listingId: string
}

export function DeleteDraftButton({ listingId }: DeleteDraftButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showConfirm, setShowConfirm] = useState(false)

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteDraftListing(listingId)
      if ('error' in result) {
        alert(result.error)
        setShowConfirm(false)
        return
      }
      router.push('/organiser/feiseanna')
    })
  }

  if (!showConfirm) {
    return (
      <button
        type="button"
        onClick={() => setShowConfirm(true)}
        className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
      >
        Delete Draft
      </button>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <p className="text-sm text-destructive">
        Are you sure? This cannot be undone.
      </p>
      <button
        type="button"
        onClick={handleDelete}
        disabled={isPending}
        className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-white hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isPending ? 'Deleting...' : 'Yes, Delete'}
      </button>
      <button
        type="button"
        onClick={() => setShowConfirm(false)}
        disabled={isPending}
        className="rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-muted"
      >
        Cancel
      </button>
    </div>
  )
}
