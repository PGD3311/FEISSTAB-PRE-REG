'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Dancer, DancerDanceLevel } from '@/lib/types/feis-listing'
import { calculateAgeOnDate } from '@/lib/engine/eligibility'

interface Step1DancersProps {
  dancers: (Dancer & { dance_levels: DancerDanceLevel[] })[]
  feisName: string
  ageCutoffDate: Date
  onNext: (selectedDancerIds: string[]) => void
}

export function Step1Dancers({ dancers, feisName, ageCutoffDate, onNext }: Step1DancersProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const activeDancers = dancers.filter(d => d.is_active)

  return (
    <div>
      <h2 className="mb-1 text-xl font-semibold">Who&apos;s dancing?</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Select the dancers from your family who will attend {feisName}.
      </p>

      {activeDancers.length === 0 ? (
        <div className="feis-card px-6 py-12 text-center">
          <p className="text-muted-foreground">No dancers in your family yet.</p>
          <Link
            href="/dashboard/dancers/new"
            className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Add a Dancer
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {activeDancers.map(dancer => {
            const age = calculateAgeOnDate(
              new Date(dancer.date_of_birth),
              ageCutoffDate
            )
            const isSelected = selected.has(dancer.id)

            return (
              <button
                key={dancer.id}
                onClick={() => toggle(dancer.id)}
                className={`feis-card w-full p-4 text-left transition-colors ${
                  isSelected ? 'border-primary ring-2 ring-primary/20' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">
                      {dancer.first_name} {dancer.last_name}
                    </div>
                    <div className="mt-0.5 text-sm text-muted-foreground">
                      Age {age} for this feis
                      {dancer.school_name ? ` · ${dancer.school_name}` : ''}
                    </div>
                  </div>
                  <div
                    className={`flex h-5 w-5 items-center justify-center rounded border ${
                      isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
                    }`}
                  >
                    {isSelected && (
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      <div className="mt-4">
        <Link
          href="/dashboard/dancers/new"
          className="text-sm font-medium text-primary hover:underline"
        >
          + Add a new dancer
        </Link>
      </div>

      <div className="mt-8 flex justify-end">
        <button
          onClick={() => onNext(Array.from(selected))}
          disabled={selected.size === 0}
          className="rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-[var(--color-feis-green-600)] disabled:opacity-50"
        >
          Next: Choose Competitions
        </button>
      </div>
    </div>
  )
}
