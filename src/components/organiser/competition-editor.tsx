'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { competitionFeeCents } from '@/lib/engine/fee-calculator'
import { formatCents } from '@/lib/format'
import type { AgeGroup, FeeSchedule, FeisCompetition } from '@/lib/types/feis-listing'
import {
  addCompetition,
  updateCompetition,
  type CompetitionEdit,
  type NewCompetition
} from '@/app/organiser/feiseanna/actions'

export type EditorCompetition = Pick<
  FeisCompetition,
  | 'id'
  | 'display_name'
  | 'display_code'
  | 'competition_type'
  | 'fee_category'
  | 'fee_cents'
  | 'exclude_from_family_cap'
  | 'grades_only'
  | 'enabled'
  | 'age_group_label'
>

const PRESETS: { label: string; values: Partial<NewCompetition>; hint?: string }[] = [
  {
    label: 'Future Champion',
    values: { display_name: 'Future Champion', fee: '35', grades_only: true }
  },
  {
    label: 'Four Hand Ceili',
    values: { display_name: 'Four Hand Ceili', fee: '40' },
    hint: 'Priced per team. One team member registers the team.'
  },
  {
    label: 'Six Hand Ceili',
    values: { display_name: 'Six Hand Ceili', fee: '60' },
    hint: 'Priced per team. One team member registers the team.'
  },
  {
    label: 'Eight Hand Ceili',
    values: { display_name: 'Eight Hand Ceili', fee: '80' },
    hint: 'Priced per team. One team member registers the team.'
  },
  {
    label: 'First Feis',
    values: { display_name: 'First Feis' },
    hint: 'For dancers who have never competed.'
  },
  {
    label: 'Unique Needs and Abilities',
    values: { display_name: 'Dancers with Unique Needs and Abilities' }
  },
  { label: 'Irish Art', values: { display_name: 'Irish Art' } }
]

const EMPTY_NEW: NewCompetition = {
  display_name: '',
  display_code: '',
  fee: '',
  exclude_from_family_cap: false,
  grades_only: false,
  age_group_key: null
}

function centsToDollars(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2)
}

function EditRow({
  comp,
  listingId,
  onDone
}: {
  comp: EditorCompetition
  listingId: string
  onDone: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<CompetitionEdit>({
    display_name: comp.display_name,
    display_code: comp.display_code ?? '',
    fee: centsToDollars(comp.fee_cents),
    exclude_from_family_cap: comp.exclude_from_family_cap,
    grades_only: comp.grades_only,
    enabled: comp.enabled
  })

  function save() {
    setError(null)
    startTransition(async () => {
      try {
        const result = await updateCompetition(listingId, comp.id, form)
        if ('error' in result) {
          setError(result.error ?? 'Failed to save')
          return
        }
        router.refresh()
        onDone()
      } catch (err) {
        console.error('Failed to save competition:', err)
        setError('An unexpected error occurred while saving.')
      }
    })
  }

  const id = `edit-${comp.id}`

  return (
    <tr className="bg-[var(--color-feis-cream)] hover:bg-[var(--color-feis-cream)]">
      <td colSpan={5} className="px-4 py-3">
        <div className="grid gap-3 sm:grid-cols-[7rem_1fr_8rem]">
          <div>
            <label htmlFor={`${id}-code`} className="feis-label">
              Code
            </label>
            <input
              id={`${id}-code`}
              className="feis-input feis-narrow"
              value={form.display_code}
              onChange={(e) => setForm({ ...form, display_code: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor={`${id}-name`} className="feis-label">
              Name
            </label>
            <input
              id={`${id}-name`}
              className="feis-input"
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor={`${id}-fee`} className="feis-label">
              Price ($)
            </label>
            <input
              id={`${id}-fee`}
              type="number"
              min="0"
              step="0.01"
              placeholder="Default"
              className="feis-input tabular-nums"
              value={form.fee}
              onChange={(e) => setForm({ ...form, fee: e.target.value })}
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="feis-tick"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            Offered
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="feis-tick"
              checked={form.exclude_from_family_cap}
              onChange={(e) => setForm({ ...form, exclude_from_family_cap: e.target.checked })}
            />
            Outside the family max
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="feis-tick"
              checked={form.grades_only}
              onChange={(e) => setForm({ ...form, grades_only: e.target.checked })}
            />
            Grades dancers only
          </label>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onDone} className="feis-btn feis-btn-outline">
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={isPending}
              className="feis-btn feis-btn-primary"
            >
              {isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </td>
    </tr>
  )
}

function AddCompetitionForm({
  listingId,
  ageGroups
}: {
  listingId: string
  ageGroups: AgeGroup[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<NewCompetition>(EMPTY_NEW)
  const [hint, setHint] = useState<string | null>(null)

  function applyPreset(preset: (typeof PRESETS)[number]) {
    setForm({ ...EMPTY_NEW, ...preset.values, age_group_key: form.age_group_key })
    setHint(preset.hint ?? null)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        const result = await addCompetition(listingId, form)
        if ('error' in result) {
          setError(result.error ?? 'Failed to add')
          return
        }
        setForm({ ...EMPTY_NEW, age_group_key: form.age_group_key })
        setHint(null)
        router.refresh()
      } catch (err) {
        console.error('Failed to add competition:', err)
        setError('An unexpected error occurred while adding.')
      }
    })
  }

  return (
    <form onSubmit={submit} className="feis-card px-5 py-5 sm:px-6">
      <h2 className="feis-display text-[22px]">Add a competition</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        For anything outside the grade and championship grid. Start from a common one or type your
        own. Add one per age group if it runs by age.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => applyPreset(preset)}
            className="rounded-[3px] border-[1.5px] border-[var(--color-feis-charcoal)] bg-white px-2.5 py-1 text-[13px] font-semibold hover:bg-[var(--color-feis-green-light)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-feis-gold)]"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_10rem_7rem_8rem]">
        <div>
          <label htmlFor="new-comp-name" className="feis-label">
            Name
          </label>
          <input
            id="new-comp-name"
            required
            className="feis-input"
            value={form.display_name}
            onChange={(e) => setForm({ ...form, display_name: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="new-comp-age" className="feis-label">
            Age group
          </label>
          <select
            id="new-comp-age"
            className="feis-input"
            value={form.age_group_key ?? ''}
            onChange={(e) => setForm({ ...form, age_group_key: e.target.value || null })}
          >
            <option value="">All ages</option>
            {ageGroups.map((age) => (
              <option key={age.key} value={age.key}>
                {age.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="new-comp-code" className="feis-label">
            Code
          </label>
          <input
            id="new-comp-code"
            className="feis-input feis-narrow"
            value={form.display_code}
            onChange={(e) => setForm({ ...form, display_code: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="new-comp-fee" className="feis-label">
            Price ($)
          </label>
          <input
            id="new-comp-fee"
            type="number"
            min="0"
            step="0.01"
            placeholder="Solo fee"
            className="feis-input tabular-nums"
            value={form.fee}
            onChange={(e) => setForm({ ...form, fee: e.target.value })}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="feis-tick"
            checked={form.grades_only}
            onChange={(e) => setForm({ ...form, grades_only: e.target.checked })}
          />
          Grades dancers only
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="feis-tick"
            checked={form.exclude_from_family_cap}
            onChange={(e) => setForm({ ...form, exclude_from_family_cap: e.target.checked })}
          />
          Outside the family max
        </label>
        <button type="submit" disabled={isPending} className="feis-btn feis-btn-primary ml-auto">
          {isPending ? 'Adding…' : 'Add competition'}
        </button>
      </div>
      {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}

const GROUPS: { label: string; types: string[] }[] = [
  { label: 'Solos', types: ['solo'] },
  { label: 'Championships', types: ['championship'] },
  { label: 'Specials and extras', types: ['special', 'custom'] }
]

export function CompetitionEditor({
  listingId,
  competitions,
  feeSchedule,
  ageGroups,
  editable
}: {
  listingId: string
  competitions: EditorCompetition[]
  feeSchedule: FeeSchedule | null
  ageGroups: AgeGroup[]
  editable: boolean
}) {
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <div className="space-y-8">
      {competitions.length === 0 && (
        <p className="feis-sticker rounded-[3px] px-4 py-3 text-sm">No competitions set up yet.</p>
      )}

      {GROUPS.map((group) => {
        const items = competitions.filter((c) => group.types.includes(c.competition_type))
        if (items.length === 0) return null
        return (
          <section key={group.label}>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 className="feis-display text-[22px]">{group.label}</h2>
              <span className="text-sm text-muted-foreground">
                <span className="feis-narrow text-[17px] text-foreground">{items.length}</span>{' '}
                {items.length === 1 ? 'competition' : 'competitions'}
              </span>
            </div>
            <div className="feis-entry-form overflow-x-auto">
              <table className="w-full">
                <thead className="feis-thead">
                  <tr>
                    <th className="w-20 text-left">Code</th>
                    <th className="text-left">Competition</th>
                    <th className="text-right">Price</th>
                    <th className="text-left">Notes</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="feis-tbody">
                  {items.map((comp) =>
                    editingId === comp.id ? (
                      <EditRow
                        key={comp.id}
                        comp={comp}
                        listingId={listingId}
                        onDone={() => setEditingId(null)}
                      />
                    ) : (
                      <tr key={comp.id} className={comp.enabled ? '' : 'text-muted-foreground'}>
                        <td className="feis-narrow px-4 py-2 text-[17px]">
                          {comp.display_code ?? '—'}
                        </td>
                        <td className="px-4 py-2 text-sm">
                          {comp.display_name}
                          {comp.competition_type === 'custom' && comp.age_group_label && (
                            <span className="text-muted-foreground">, {comp.age_group_label}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right text-sm tabular-nums">
                          {feeSchedule ? formatCents(competitionFeeCents(comp, feeSchedule)) : '—'}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {[
                            !comp.enabled && 'Not offered',
                            comp.grades_only && 'Grades only',
                            comp.exclude_from_family_cap && 'Outside family max'
                          ]
                            .filter(Boolean)
                            .join(', ')}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {editable && (
                            <button
                              type="button"
                              onClick={() => setEditingId(comp.id)}
                              className="feis-link text-sm"
                              aria-label={`Edit ${comp.display_name}`}
                            >
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}

      {editable && <AddCompetitionForm listingId={listingId} ageGroups={ageGroups} />}
    </div>
  )
}
