'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { PageTitle } from '@/components/page-title'
import { createDancer } from '../actions'

const STANDARD_DANCES = [
  { key: 'reel', label: 'Reel' },
  { key: 'light_jig', label: 'Light Jig' },
  { key: 'slip_jig', label: 'Slip Jig' },
  { key: 'single_jig', label: 'Single Jig' },
  { key: 'treble_jig', label: 'Treble Jig' },
  { key: 'hornpipe', label: 'Hornpipe' }
]

const LEVELS = [
  { key: 'BG', label: 'Beginner' },
  { key: 'AB', label: 'Advanced Beginner' },
  { key: 'NOV', label: 'Novice' },
  { key: 'PW', label: 'Prizewinner' }
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
      setError('Fill in the first name, last name and date of birth.')
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
        level_overrides: Object.keys(levelOverrides).length > 0 ? levelOverrides : undefined
      })

      if ('error' in result) {
        setError(result.error ?? 'Unknown error')
      } else {
        router.push('/dashboard/dancers')
      }
    })
  }

  return (
    <div className="max-w-2xl">
      <Link
        href="/dashboard/dancers"
        className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        All dancers
      </Link>
      <div className="mt-2">
        <PageTitle
          title="Add a dancer"
          intro="Set this up once. Every feis uses it to show the competitions this dancer can enter."
        />
      </div>

      <form onSubmit={handleSubmit}>
        <div className="feis-entry-form">
          <section className="px-5 py-6 sm:px-7">
            <h2 className="feis-display mb-4 text-[22px]">The dancer</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="feis-label" htmlFor="firstName">
                  First name
                </label>
                <input
                  id="firstName"
                  type="text"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="feis-input"
                  placeholder="Siobhán"
                />
              </div>
              <div>
                <label className="feis-label" htmlFor="lastName">
                  Last name
                </label>
                <input
                  id="lastName"
                  type="text"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="feis-input"
                  placeholder="O'Brien"
                />
              </div>
              <div>
                <label className="feis-label" htmlFor="dateOfBirth">
                  Date of birth
                </label>
                <input
                  id="dateOfBirth"
                  type="date"
                  required
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  className="feis-input"
                />
              </div>
              <fieldset>
                <legend className="feis-label">Gender</legend>
                <div className="flex gap-5 pt-2">
                  {(['female', 'male'] as const).map((g) => (
                    <label key={g} className="flex cursor-pointer items-center gap-2 text-[15px]">
                      <input
                        type="radio"
                        name="gender"
                        value={g}
                        checked={gender === g}
                        onChange={() => setGender(g)}
                        className="h-4 w-4 accent-[var(--color-feis-green)]"
                      />
                      <span className="capitalize">{g}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </section>

          <section className="border-t-[1.5px] border-[var(--color-feis-charcoal)] px-5 py-6 sm:px-7">
            <h2 className="feis-display mb-4 text-[22px]">School and teacher</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="feis-label" htmlFor="schoolName">
                  School <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <input
                  id="schoolName"
                  type="text"
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  className="feis-input"
                  placeholder="Scoil Rince na Gréine"
                />
              </div>
              <div>
                <label className="feis-label" htmlFor="tcrgName">
                  Teacher (TCRG){' '}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <input
                  id="tcrgName"
                  type="text"
                  value={tcrgName}
                  onChange={(e) => setTcrgName(e.target.value)}
                  className="feis-input"
                  placeholder="Ms. Murphy TCRG"
                />
              </div>
            </div>
          </section>

          <section className="border-t-[1.5px] border-[var(--color-feis-charcoal)] px-5 py-6 sm:px-7">
            <h2 className="feis-display mb-4 text-[22px]">Levels</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="feis-label" htmlFor="championshipStatus">
                  Championship status
                </label>
                <select
                  id="championshipStatus"
                  value={championshipStatus}
                  onChange={(e) =>
                    setChampionshipStatus(e.target.value as 'none' | 'prelim' | 'open')
                  }
                  className="feis-input"
                >
                  <option value="none">Solo dancer</option>
                  <option value="prelim">Prelim Championship</option>
                  <option value="open">Open Championship</option>
                </select>
              </div>
              <div>
                <label className="feis-label" htmlFor="defaultLevel">
                  Level for every dance
                </label>
                <select
                  id="defaultLevel"
                  value={defaultLevel}
                  onChange={(e) => handleDefaultLevelChange(e.target.value)}
                  className="feis-input"
                >
                  {LEVELS.map((l) => (
                    <option key={l.key} value={l.key}>
                      {l.label} ({l.key})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  If some dances are at a different level, set them below.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowPerDance((v) => !v)}
              aria-expanded={showPerDance}
              aria-controls="per-dance-levels"
              className="feis-link mt-5 text-sm"
            >
              {showPerDance
                ? 'Hide levels for each dance'
                : 'Set a different level for some dances'}
            </button>

            {showPerDance && (
              <div id="per-dance-levels" className="mt-3">
                <p className="mb-2 text-[13px] text-muted-foreground">
                  Each dance starts at the level above. Change only the ones that differ.
                </p>
                <ul className="border-y-[1.5px] border-[var(--color-feis-charcoal)]">
                  {STANDARD_DANCES.map((dance, i) => (
                    <li
                      key={dance.key}
                      className={`flex items-center justify-between gap-3 py-2 ${
                        i > 0 ? 'border-t border-[#E2DCCD]' : ''
                      }`}
                    >
                      <label htmlFor={`level-${dance.key}`} className="text-[15px] font-semibold">
                        {dance.label}
                      </label>
                      <select
                        id={`level-${dance.key}`}
                        value={getEffectiveLevel(dance.key)}
                        onChange={(e) => handleLevelOverride(dance.key, e.target.value)}
                        className="feis-input w-auto py-1"
                      >
                        {LEVELS.map((l) => (
                          <option key={l.key} value={l.key}>
                            {l.label} ({l.key})
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-5 border-l-4 border-destructive bg-white px-4 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={isPending} className="feis-btn feis-btn-primary">
            {isPending ? 'Saving…' : 'Save dancer'}
          </button>
          <Link href="/dashboard/dancers" className="feis-btn feis-btn-outline">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
