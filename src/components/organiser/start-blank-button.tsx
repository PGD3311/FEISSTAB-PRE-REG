'use client'

import { useFormStatus } from 'react-dom'

export function StartBlankButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="feis-btn feis-btn-primary">
      {pending ? 'Creating…' : 'Start a blank feis'}
    </button>
  )
}
