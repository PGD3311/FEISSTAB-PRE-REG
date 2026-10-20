'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { approveListing, sendBackListing } from '@/app/admin/approvals/actions'

export function ApprovalActions({ listingId }: { listingId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [sendingBack, setSendingBack] = useState(false)
  const [note, setNote] = useState('')

  function run(action: () => Promise<{ success: true } | { error: string }>, failure: string) {
    setError(null)
    startTransition(async () => {
      try {
        const result = await action()
        if ('error' in result) {
          setError(result.error)
          return
        }
        setSendingBack(false)
        setNote('')
        router.refresh()
      } catch (err) {
        console.error(failure, err)
        setError(`${failure} Check your connection and try again.`)
      }
    })
  }

  function handleSendBack(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (note.trim() === '') {
      setError('Write a note saying what the organiser needs to fix.')
      return
    }
    run(() => sendBackListing(listingId, note), 'The feis could not be sent back.')
  }

  return (
    <div>
      {sendingBack ? (
        <form onSubmit={handleSendBack} className="max-w-xl">
          <label htmlFor={`note-${listingId}`} className="feis-label">
            What does the organiser need to fix?
          </label>
          <textarea
            id={`note-${listingId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            required
            rows={3}
            className="feis-input"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            The organiser sees this note on their feis and in an email.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" disabled={isPending} className="feis-btn feis-btn-ink">
              {isPending ? 'Sending back…' : 'Send back'}
            </button>
            <button
              type="button"
              onClick={() => {
                setSendingBack(false)
                setError(null)
              }}
              disabled={isPending}
              className="feis-btn feis-btn-outline"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => run(() => approveListing(listingId), 'The feis could not be approved.')}
            disabled={isPending}
            className="feis-btn feis-btn-primary"
          >
            {isPending ? 'Approving…' : 'Approve'}
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null)
              setSendingBack(true)
            }}
            disabled={isPending}
            className="feis-btn feis-btn-outline"
          >
            Send back
          </button>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="mt-3 max-w-xl border-l-4 border-destructive bg-white px-4 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  )
}
