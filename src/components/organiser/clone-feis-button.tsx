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
      className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
    >
      {isPending ? 'Cloning...' : 'Clone This Feis'}
    </button>
  )
}
