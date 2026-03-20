'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createDancer } from '../actions'

const STANDARD_DANCES = [
  { key: 'reel', label: 'Reel' },
  { key: 'light_jig', label: 'Light Jig' },
  { key: 'slip_jig', label: 'Slip Jig' },
  { key: 'single_jig', label: 'Single Jig' },
  { key: 'treble_jig', label: 'Treble Jig' },
  { key: 'hornpipe', label: 'Hornpipe' },
]

const LEVELS = [
  { key: 'BG', label: 'Beginner' },
  { key: 'AB', label: 'Advanced Beginner' },
  { key: 'NOV', label: 'Novice' },
  { key: 'PW', label: 'Prizewinner' },
]

export default function NewDancerPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [gender, setGender] = useState<'female' | 'male'>('female')
  const [schoolName, setSchoolName] = useState('')
  const [tcrgName, setTcrgName] = useState('')
  const [championshipStatus, setChampionshipStatus] = useState<'none' | 'prelim' | 'open'>('none')
  const [defaultLevel, setDefaultLevel] = useState('NOV')
  const [levelOverrides, setLevelOverrides] = useState<Record<string, string>>({})
  const [showPerDance, setShowPerDance] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleDefaultLevelChange(level: string) {
    setDefaultLevel(level)
    // Reset overrides when default changes so overrides stay meaningful
    setLevelOverrides({})
  }

  function handleLevelOverride(danceKey: string, levelKey: string) {
    setLevelOverrides((prev) => ({ ...prev, [danceKey]: levelKey }))
  }

  function getEffectiveLevel(danceKey: string): string {
    return levelOverrides[danceKey] ?? defaultLevel
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!firstName.trim() || !lastName.trim() || !dateOfBirth) {
      setError('First name, last name, and date of birth are required.')
      return
    }

    startTransition(async () => {
      const result = await createDancer({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        date_of_birth: dateOfBirth,
        gender,
        school_name: schoolName.trim() || null,
        tcrg_name: tcrgName.trim() || null,
        championship_status: championshipStatus,
        default_level: defaultLevel,
        level_overrides: Object.keys(levelOverrides).length > 0 ? levelOverrides : undefined,
      })

      if ('error' in result) {
        setError(result.error ?? 'Unknown error')
      } else {
        router.push('/dashboard/dancers')
      }
    })
  }

  return (
    <div>
      <div className="mb-6">
        <Link href="/dashboard/dancers" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to Dancers
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Add Dancer</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic info */}
        <div className="feis-card p-6">
          <h2 className="mb-4 text-base font-semibold">Dancer Information</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="firstName">
                First Name <span className="text-destructive">*</span>
              </label>
              <input
                id="firstName"
                type="text"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Siobhán"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="lastName">
                Last Name <span className="text-destructive">*</span>
              </label>
              <input
                id="lastName"
                type="text"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="O'Brien"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="dateOfBirth">
                Date of Birth <span className="text-destructive">*</span>
              </label>
              <input
                id="dateOfBirth"
                type="date"
                required
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <p className="mb-1 block text-sm font-medium">
                Gender <span className="text-destructive">*</span>
              </p>
              <div className="flex gap-4 pt-1">
                {(['female', 'male'] as const).map((g) => (
                  <label key={g} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="gender"
                      value={g}
                      checked={gender === g}
                      onChange={() => setGender(g)}
                      className="accent-primary"
                    />
                    <span className="capitalize">{g}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* School / teacher */}
        <div className="feis-card p-6">
          <h2 className="mb-4 text-base font-semibold">School &amp; Teacher</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="schoolName">
                School Name <span className="text-xs text-muted-foreground">(optional)</span>
              </label>
              <input
                id="schoolName"
                type="text"
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Scoil Rince na Gréine"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="tcrgName">
                Teacher Name (TCRG) <span className="text-xs text-muted-foreground">(optional)</span>
              </label>
              <input
                id="tcrgName"
                type="text"
                value={tcrgName}
                onChange={(e) => setTcrgName(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Ms. Murphy TCRG"
              />
            </div>
          </div>
        </div>

        {/* Levels */}
        <div className="feis-card p-6">
          <h2 className="mb-4 text-base font-semibold">Competition Level</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="championshipStatus">
                Championship Status
              </label>
              <select
                id="championshipStatus"
                value={championshipStatus}
                onChange={(e) => setChampionshipStatus(e.target.value as 'none' | 'prelim' | 'open')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="none">Solo dancer</option>
                <option value="prelim">Prelim Championship</option>
                <option value="open">Open Championship</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="defaultLevel">
                Default Level
              </label>
              <select
                id="defaultLevel"
                value={defaultLevel}
                onChange={(e) => handleDefaultLevelChange(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {LEVELS.map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.key} — {l.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Sets the same level for all dances. Adjust per-dance below if needed.
              </p>
            </div>
          </div>

          {/* Per-dance overrides */}
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowPerDance((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              <svg
                className={`h-3.5 w-3.5 transition-transform ${showPerDance ? 'rotate-90' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              Per-dance level adjustments
            </button>

            {showPerDance && (
              <div className="mt-3 rounded-md border border-border bg-muted/30 p-4">
                <p className="mb-3 text-xs text-muted-foreground">
                  Override the default level for individual dances. Leave as default to use the level
                  set above.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {STANDARD_DANCES.map((dance) => (
                    <div key={dance.key} className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{dance.label}</span>
                      <select
                        value={getEffectiveLevel(dance.key)}
                        onChange={(e) => handleLevelOverride(dance.key, e.target.value)}
                        className="rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        {LEVELS.map((l) => (
                          <option key={l.key} value={l.key}>
                            {l.key}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-[var(--color-feis-green-600)] disabled:opacity-60"
          >
            {isPending ? 'Saving…' : 'Add Dancer'}
          </button>
          <Link
            href="/dashboard/dancers"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
