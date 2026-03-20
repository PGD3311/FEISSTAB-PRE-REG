'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Dancer } from '@/lib/types/feis-listing'
import { updateDancer, archiveDancer } from '../actions'

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

interface Props {
  dancer: Dancer
  initialLevels: Record<string, string>
}

export function EditDancerForm({ dancer, initialLevels }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isArchiving, startArchiveTransition] = useTransition()

  const [firstName, setFirstName] = useState(dancer.first_name)
  const [lastName, setLastName] = useState(dancer.last_name)
  const [dateOfBirth, setDateOfBirth] = useState(dancer.date_of_birth)
  const [gender, setGender] = useState<'female' | 'male'>(dancer.gender)
  const [schoolName, setSchoolName] = useState(dancer.school_name ?? '')
  const [tcrgName, setTcrgName] = useState(dancer.tcrg_name ?? '')
  const [championshipStatus, setChampionshipStatus] = useState<'none' | 'prelim' | 'open'>(
    dancer.championship_status
  )
  const [levels, setLevels] = useState<Record<string, string>>(() => {
    // Fill in any missing dances with NOV as default
    const map: Record<string, string> = {}
    for (const dance of STANDARD_DANCES) {
      map[dance.key] = initialLevels[dance.key] ?? 'NOV'
    }
    return map
  })
  const [error, setError] = useState<string | null>(null)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)

  function handleLevelChange(danceKey: string, levelKey: string) {
    setLevels((prev) => ({ ...prev, [danceKey]: levelKey }))
  }

  function handleBulkUpdate(levelKey: string) {
    const updated: Record<string, string> = {}
    for (const dance of STANDARD_DANCES) {
      updated[dance.key] = levelKey
    }
    setLevels(updated)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!firstName.trim() || !lastName.trim() || !dateOfBirth) {
      setError('First name, last name, and date of birth are required.')
      return
    }

    startTransition(async () => {
      const result = await updateDancer(dancer.id, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        date_of_birth: dateOfBirth,
        gender,
        school_name: schoolName.trim() || null,
        tcrg_name: tcrgName.trim() || null,
        championship_status: championshipStatus,
        levels,
      })

      if ('error' in result) {
        setError(result.error ?? 'Unknown error')
      } else {
        router.push('/dashboard/dancers')
      }
    })
  }

  function handleArchive() {
    startArchiveTransition(async () => {
      const result = await archiveDancer(dancer.id)
      if ('error' in result) {
        setError(result.error ?? 'Unknown error')
        setShowArchiveConfirm(false)
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
        <h1 className="mt-2 text-2xl font-bold">
          {dancer.first_name} {dancer.last_name}
        </h1>
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
              />
            </div>
          </div>
        </div>

        {/* Championship status */}
        <div className="feis-card p-6">
          <h2 className="mb-4 text-base font-semibold">Championship Status</h2>
          <div className="max-w-xs">
            <label className="mb-1 block text-sm font-medium" htmlFor="championshipStatus">
              Status
            </label>
            <select
              id="championshipStatus"
              value={championshipStatus}
              onChange={(e) =>
                setChampionshipStatus(e.target.value as 'none' | 'prelim' | 'open')
              }
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="none">Solo dancer</option>
              <option value="prelim">Prelim Championship</option>
              <option value="open">Open Championship</option>
            </select>
          </div>
        </div>

        {/* Dance levels */}
        <div className="feis-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold">Dance Levels</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Update all to:</span>
              {LEVELS.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => handleBulkUpdate(l.key)}
                  className="rounded border border-border px-2 py-1 text-xs font-medium hover:border-primary hover:text-primary"
                >
                  {l.key}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {STANDARD_DANCES.map((dance) => (
              <div key={dance.key} className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{dance.label}</span>
                <select
                  value={levels[dance.key] ?? 'NOV'}
                  onChange={(e) => handleLevelChange(dance.key, e.target.value)}
                  className="rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {LEVELS.map((l) => (
                    <option key={l.key} value={l.key}>
                      {l.key} — {l.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isPending || isArchiving}
              className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-[var(--color-feis-green-600)] disabled:opacity-60"
            >
              {isPending ? 'Saving…' : 'Save Changes'}
            </button>
            <Link
              href="/dashboard/dancers"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Link>
          </div>

          {/* Archive */}
          <div>
            {showArchiveConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Archive this dancer?</span>
                <button
                  type="button"
                  onClick={handleArchive}
                  disabled={isArchiving}
                  className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
                >
                  {isArchiving ? 'Archiving…' : 'Yes, archive'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowArchiveConfirm(false)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowArchiveConfirm(true)}
                disabled={isPending || isArchiving}
                className="text-sm text-muted-foreground hover:text-destructive"
              >
                Archive dancer
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  )
}
