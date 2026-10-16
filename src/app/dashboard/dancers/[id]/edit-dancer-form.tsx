'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Dancer } from '@/lib/types/feis-listing'
import { PageTitle } from '@/components/page-title'
import { SchoolPicker } from '@/components/registration/school-picker'
import { updateDancer, archiveDancer } from '../actions'

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

interface Props {
  dancer: Dancer
  initialLevels: Record<string, string>
  /** The dancer's competitor numbers, shown under the title */
  numbers?: React.ReactNode
}

export function EditDancerForm({ dancer, initialLevels, numbers }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isArchiving, startArchiveTransition] = useTransition()

  const [firstName, setFirstName] = useState(dancer.first_name)
  const [lastName, setLastName] = useState(dancer.last_name)
  const [dateOfBirth, setDateOfBirth] = useState(dancer.date_of_birth)
  const [gender, setGender] = useState<'female' | 'male'>(dancer.gender)
  const [school, setSchool] = useState<{ id: string | null; name: string }>({
    id: dancer.school_id ?? null,
    name: dancer.school_name ?? ''
  })
  const [relationship, setRelationship] = useState<'household' | 'guest'>(
    dancer.relationship ?? 'household'
  )
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
      setError('Fill in the first name, last name and date of birth.')
      return
    }

    startTransition(async () => {
      const result = await updateDancer(dancer.id, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        date_of_birth: dateOfBirth,
        gender,
        school_name: school.name.trim() || null,
        school_id: school.id,
        relationship,
        tcrg_name: tcrgName.trim() || null,
        championship_status: championshipStatus,
        levels
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
    <div className="max-w-2xl">
      <Link
        href="/dashboard/dancers"
        className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        All dancers
      </Link>
      <div className="mt-2">
        <PageTitle
          title={`${dancer.first_name} ${dancer.last_name}`}
          intro="Keep levels up to date so each feis shows the right competitions for this dancer."
        />
      </div>

      {numbers}

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
            <fieldset className="mt-5">
              <legend className="feis-label">Who is this dancer?</legend>
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ['household', 'Part of my family'],
                    ['guest', 'Someone else’s child I’m entering']
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-[3px] border-[1.5px] px-3 py-2.5 text-sm ${
                      relationship === value
                        ? 'border-[var(--color-feis-green)] bg-[var(--color-feis-green-light)]'
                        : 'border-[var(--input)] bg-white'
                    }`}
                  >
                    <input
                      type="radio"
                      name="relationship"
                      checked={relationship === value}
                      onChange={() => setRelationship(value)}
                      className="accent-[var(--color-feis-green)]"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          </section>

          <section className="border-t-[1.5px] border-[var(--color-feis-charcoal)] px-5 py-6 sm:px-7">
            <h2 className="feis-display mb-4 text-[22px]">School and teacher</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <SchoolPicker value={school} onChange={setSchool} />
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
                />
              </div>
            </div>
          </section>

          <section className="border-t-[1.5px] border-[var(--color-feis-charcoal)] px-5 py-6 sm:px-7">
            <h2 className="feis-display mb-4 text-[22px]">Levels</h2>
            <div className="max-w-xs">
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

            <div className="mt-6 mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <h3 className="text-[15px] font-bold">Level for each dance</h3>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[13px] text-muted-foreground">Set all to</span>
                {LEVELS.map((l) => (
                  <button
                    key={l.key}
                    type="button"
                    onClick={() => handleBulkUpdate(l.key)}
                    aria-label={`Set all dances to ${l.label}`}
                    title={l.label}
                    className="feis-btn feis-btn-outline feis-narrow px-2 py-0.5 text-[15px]"
                  >
                    {l.key}
                  </button>
                ))}
              </div>
            </div>
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
                    value={levels[dance.key] ?? 'NOV'}
                    onChange={(e) => handleLevelChange(dance.key, e.target.value)}
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

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={isPending || isArchiving}
              className="feis-btn feis-btn-primary"
            >
              {isPending ? 'Saving…' : 'Save changes'}
            </button>
            <Link href="/dashboard/dancers" className="feis-btn feis-btn-outline">
              Cancel
            </Link>
          </div>

          <div>
            {showArchiveConfirm ? (
              <div
                role="group"
                aria-label="Confirm archive"
                className="flex flex-wrap items-center gap-2"
              >
                <span className="text-sm">
                  Archive {dancer.first_name}? They won&apos;t show when you enter a feis.
                </span>
                <button
                  type="button"
                  onClick={handleArchive}
                  disabled={isArchiving}
                  className="feis-btn feis-btn-danger"
                >
                  {isArchiving ? 'Archiving…' : 'Yes, archive'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowArchiveConfirm(false)}
                  className="feis-btn feis-btn-outline"
                >
                  Keep
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowArchiveConfirm(true)}
                disabled={isPending || isArchiving}
                className="text-sm font-semibold text-muted-foreground underline underline-offset-2 hover:text-destructive disabled:opacity-50"
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
