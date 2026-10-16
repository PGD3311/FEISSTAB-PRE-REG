'use client'

import { useTransition } from 'react'

import { cloneFeisAndRedirect } from '@/app/organiser/feiseanna/actions'

interface CloneFeisButtonProps {
  listingId: string
}

export function CloneFeisButton({ listingId }: CloneFeisButtonProps) {
  const [isPending, startTransition] = useTransition()

  function handleClone() {
    startTransition(async () => {
      const result = await cloneFeisAndRedirect(listingId)
      if (result && 'error' in result) {
        alert(result.error)
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleClone}
      disabled={isPending}
      className="feis-btn feis-btn-outline"
    >
      {isPending ? 'Copying…' : 'Copy as a new feis'}
    </button>
  )
}
