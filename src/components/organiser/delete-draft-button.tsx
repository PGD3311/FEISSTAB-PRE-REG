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
        className="feis-btn feis-btn-danger"
      >
        Delete this draft
      </button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm font-bold text-destructive" role="alert">
        Delete this draft for good? This can&apos;t be undone.
      </p>
      <button
        type="button"
        onClick={handleDelete}
        disabled={isPending}
        className="feis-btn border-destructive bg-destructive text-white hover:bg-destructive/90"
      >
        {isPending ? 'Deleting…' : 'Yes, delete it'}
      </button>
      <button
        type="button"
        onClick={() => setShowConfirm(false)}
        disabled={isPending}
        className="feis-btn feis-btn-outline"
      >
        Keep it
      </button>
    </div>
  )
}
