'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createHousehold } from '@/app/dashboard/actions'
import { CoverBand } from '@/components/feis-cover'

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

  const choiceClass =
    'w-full border-t border-[#E2DCCD] px-1 py-4 text-left first:border-t-0 hover:bg-[var(--color-feis-green-light)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-feis-gold)] disabled:opacity-50'

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-feis-cream)]">
      <CoverBand links={[{ href: '/', label: 'Feiseanna' }]}>
        <div className="min-w-0 pt-3">
          <h1 className="feis-cover-title text-[clamp(34px,6vw,56px)]">Welcome to RunFeis</h1>
          <p className="mt-1.5 max-w-[52ch] opacity-85">What do you want to do first?</p>
        </div>
      </CoverBand>

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-10">
        <div className="feis-card px-5 py-2">
          <button
            type="button"
            onClick={handleParentIntent}
            disabled={loading !== null}
            className={choiceClass}
          >
            <span className="block text-[20px] leading-tight font-extrabold [font-stretch:75%]">
              {loading === 'parent' ? 'Setting up your family…' : 'Enter my dancers in a feis'}
            </span>
            <span className="mt-1 block text-sm text-muted-foreground">
              Set up your family and dancers, then pick a feis.
            </span>
          </button>

          <button
            type="button"
            onClick={handleOrganiserIntent}
            disabled={loading !== null}
            className={choiceClass}
          >
            <span className="block text-[20px] leading-tight font-extrabold [font-stretch:75%]">
              Run a feis as an organiser
            </span>
            <span className="mt-1 block text-sm text-muted-foreground">
              Set up your feis with its syllabus, fees and closing dates.
            </span>
          </button>
        </div>

        <p className="mt-4 text-center text-[13px] text-muted-foreground">
          You can do both with the same account later.
        </p>
      </main>
    </div>
  )
}
