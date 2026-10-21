'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ordinal, type LevelMove } from '@/lib/engine/level-moves'
import { acceptLevelMove } from '@/app/dashboard/dancers/actions'

interface Props {
  moves: LevelMove[]
  /** First name for each dancer id */
  dancerNames: Record<string, string>
  /** Label for each level key */
  levelLabels: Record<string, string>
}

/** Wins that move a dancer up a level, each with a one-tap "Move up". */
export function LevelMoveNotice({ moves, dancerNames, levelLabels }: Props) {
  const router = useRouter()
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  if (moves.length === 0) return null
  const label = (key: string | null) => (key ? (levelLabels[key] ?? key) : 'no level set')

  function accept(move: LevelMove) {
    const key = `${move.dancerId}|${move.danceKey}`
    setPendingKey(key)
    setError(null)
    startTransition(async () => {
      const result = await acceptLevelMove(move.dancerId, move.danceKey)
      if ('error' in result) setError(result.error ?? 'Something went wrong. Try again.')
      setPendingKey(null)
      router.refresh()
    })
  }

  return (
    <section className="feis-sticker mb-6 max-w-3xl rounded px-5 py-5" aria-label="Moving up">
      <h2 className="feis-display text-[22px]">Moving up</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        From published feis results. A move counts for that dance only, and only when five or
        more dancers competed.
      </p>
      <ul className="mt-4 divide-y divide-[#E6D88E] border-y border-[#E6D88E]">
        {moves.map((move) => {
          const key = `${move.dancerId}|${move.danceKey}`
          const name = dancerNames[move.dancerId] ?? 'Your dancer'
          return (
            <li
              key={key}
              className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <div className="min-w-0">
                <p className="font-bold">
                  {name}: {move.danceLabel}, {label(move.fromLevel)} → {label(move.toLevel)}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {ordinal(move.because.place)} in {label(move.because.levelKey)}{' '}
                  {move.danceLabel} at {move.because.feisName},{' '}
                  {move.because.dancersInCompetition} dancers
                </p>
              </div>
              <button
                type="button"
                className="feis-btn feis-btn-ink"
                disabled={pendingKey !== null}
                onClick={() => accept(move)}
              >
                {pendingKey === key ? 'Moving up…' : `Move up to ${label(move.toLevel)}`}
              </button>
            </li>
          )
        })}
      </ul>
      {error && (
        <p role="alert" className="mt-3 text-sm font-bold text-[var(--color-feis-orange-ink)]">
          {error}
        </p>
      )}
    </section>
  )
}
