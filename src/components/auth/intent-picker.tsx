'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createHousehold } from '@/app/dashboard/actions'

export function IntentPicker() {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)

  async function handleParentIntent() {
    setLoading('parent')
    try {
      const result = await createHousehold()
      if ('error' in result) {
        console.error(result.error)
        return
      }
      router.push('/dashboard/dancers/new')
    } finally {
      setLoading(null)
    }
  }

  function handleOrganiserIntent() {
    setLoading('organiser')
    router.push('/organiser/feiseanna/new')
  }

  return (
    <div className="mx-auto mt-20 max-w-md px-6">
      <div className="feis-card p-8">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold">Welcome to FeisTab</h1>
          <p className="mt-2 text-sm text-muted-foreground">What do you want to do first?</p>
        </div>

        <div className="space-y-3">
          <button
            onClick={handleParentIntent}
            disabled={loading !== null}
            className="w-full rounded-md border border-input bg-background px-4 py-4 text-left transition-colors hover:bg-muted disabled:opacity-50"
          >
            <div className="font-medium">Register a dancer for a feis</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Set up your family and browse competitions
            </div>
          </button>

          <button
            onClick={handleOrganiserIntent}
            disabled={loading !== null}
            className="w-full rounded-md border border-input bg-background px-4 py-4 text-left transition-colors hover:bg-muted disabled:opacity-50"
          >
            <div className="font-medium">Set up a feis as an organiser</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Create a feis listing with syllabus, fees, and deadlines
            </div>
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          You can always access both sides later.
        </p>
      </div>
    </div>
  )
}
