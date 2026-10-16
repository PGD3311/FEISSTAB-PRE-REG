'use client'

import { useEffect, useMemo, useState } from 'react'

import { getFeisEntries } from '@/app/organiser/feiseanna/actions'
import { groupForEntryForm } from '@/lib/entry-display'
import { summariseEntries } from '@/lib/entry-stats'
import { formatCents } from '@/lib/format'
import type { FeisCompetition } from '@/lib/types/feis-listing'

export interface EntryRow {
  id: string
  dancer_id: string
  feis_competition_id: string
  fee_category: string
  dancers: {
    first_name: string
    last_name: string
    school_name: string | null
  }
  feis_competitions: {
    display_name: string
    display_code: string | null
  }
  registrations: {
    status: string
    confirmation_number: string | null
  }
}

export interface EntrySummary {
  familiesPaid: number
  revenueCents: number
  pendingCount: number
}

function CountLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5 py-0.5">
      <span className="text-sm">{label}</span>
      <span className="feis-leader" />
      <span className="feis-narrow text-[30px] leading-none tabular-nums">{value}</span>
    </div>
  )
}

function competitionName(comp: FeisCompetition): string {
  return comp.competition_type === 'solo' && comp.dance_label ? comp.dance_label : comp.display_name
}

function exportToCsv(entries: EntryRow[], numbers: Record<string, number>) {
  const headers = [
    'Competitor number',
    'Dancer first name',
    'Dancer last name',
    'School',
    'Competition code',
    'Competition',
    'Status',
    'Confirmation'
  ]

  const rows = entries.map((e) => [
    numbers[e.dancer_id] ?? '',
    e.dancers.first_name,
    e.dancers.last_name,
    e.dancers.school_name ?? '',
    e.feis_competitions.display_code ?? '',
    e.feis_competitions.display_name,
    e.registrations.status === 'paid' ? 'Paid' : 'Still paying',
    e.registrations.confirmation_number ?? ''
  ])

  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', 'entries.csv')
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function EntriesTab({ listingId }: { listingId: string }) {
  const [entries, setEntries] = useState<EntryRow[]>([])
  const [competitions, setCompetitions] = useState<FeisCompetition[]>([])
  const [numbers, setNumbers] = useState<Record<string, number>>({})
  const [summary, setSummary] = useState<EntrySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const result = await getFeisEntries(listingId)
        if ('error' in result) {
          setError(result.error ?? 'Unknown error')
        } else {
          setEntries(result.entries as unknown as EntryRow[])
          setCompetitions(result.competitions as FeisCompetition[])
          setNumbers(result.numbers)
          setSummary(result.summary)
        }
      } catch (err) {
        console.error('Failed to load entries:', err)
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [listingId])

  if (loading) {
    return (
      <p role="status" className="py-12 text-center text-sm text-muted-foreground">
        Loading entries…
      </p>
    )
  }

  if (error) {
    return (
      <p
        role="alert"
        className="max-w-xl border-l-4 border-destructive bg-white px-4 py-3 text-sm text-destructive"
      >
        The entries couldn&apos;t be loaded. Refresh the page to try again.
        <span className="mt-1 block text-[13px] text-muted-foreground">{error}</span>
      </p>
    )
  }

  return (
    <EntriesView
      entries={entries}
      competitions={competitions}
      numbers={numbers}
      summary={summary}
    />
  )
}

export interface EntriesViewProps {
  entries: EntryRow[]
  competitions: FeisCompetition[]
  numbers: Record<string, number>
  summary: EntrySummary | null
}

/** The organiser's entries: totals, who's coming by level, and each competition's dancers. */
export function EntriesView({ entries, competitions, numbers, summary }: EntriesViewProps) {
  const [showEmpty, setShowEmpty] = useState(false)

  const stats = useMemo(
    () =>
      summariseEntries(
        entries.map((e) => ({
          dancerId: e.dancer_id,
          competitionId: e.feis_competition_id,
          status: e.registrations.status
        })),
        competitions
      ),
    [entries, competitions]
  )

  const dancerById = useMemo(() => {
    const map = new Map<string, EntryRow['dancers']>()
    for (const e of entries) map.set(e.dancer_id, e.dancers)
    return map
  }, [entries])

  const groups = useMemo(
    () =>
      groupForEntryForm(
        competitions
          .filter((c) => showEmpty || stats.dancersByCompetition.has(c.id))
          .map((competition) => ({ competition, eligible: true, reason: '' }))
      ),
    [competitions, stats, showEmpty]
  )

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      {summary && (
        <aside className="feis-receipt w-full max-w-md px-[18px] pt-5 pb-[18px] lg:sticky lg:top-6 lg:order-2 lg:max-w-none">
          <h2 className="feis-display text-[22px]">Entries so far</h2>
          <p className="mb-3 text-[13px] text-muted-foreground">Paid entries only</p>
          <CountLine label="Families" value={summary.familiesPaid} />
          <CountLine label="Dancers" value={stats.paidDancers} />
          <CountLine label="Entries" value={stats.paidEntries} />
          <div className="mt-2.5 flex items-baseline justify-between border-t-[3px] border-[var(--color-feis-gold)] pt-2.5">
            <span className="font-bold">Paid so far</span>
            <strong className="feis-narrow text-[40px] leading-none tabular-nums">
              {formatCents(summary.revenueCents)}
            </strong>
          </div>
          {summary.pendingCount > 0 && (
            <p className="mt-3 text-[13px] text-muted-foreground">
              {summary.pendingCount} {summary.pendingCount === 1 ? 'family is' : 'families are'}{' '}
              part way through paying. They&apos;re not counted until they finish.
            </p>
          )}
        </aside>
      )}

      <div className="grid min-w-0 gap-8 lg:order-1">
        {stats.paidEntries === 0 ? (
          <div className="feis-sticker max-w-xl rounded px-5 py-5">
            <p className="font-bold">No paid entries yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Entries appear here as soon as a family pays.
            </p>
          </div>
        ) : (
          <>
            <section>
              <h2 className="feis-display mb-2 text-[22px]">Who&apos;s coming, by level</h2>
              <div className="feis-entry-form max-w-xl">
                <div className="grid grid-cols-[minmax(0,1fr)_80px_80px] gap-3 border-b-[1.5px] border-[var(--color-feis-charcoal)] px-4 py-2 text-[13px] font-bold text-muted-foreground">
                  <span>Level</span>
                  <span className="text-right">Dancers</span>
                  <span className="text-right">Entries</span>
                </div>
                {stats.byLevel.map((l) => (
                  <div
                    key={l.label}
                    className="grid grid-cols-[minmax(0,1fr)_80px_80px] items-baseline gap-3 border-t border-[#E2DCCD] px-4 py-2 first-of-type:border-t-0"
                  >
                    <span className="font-semibold">{l.label}</span>
                    <span className="feis-narrow text-right text-[24px] leading-none">
                      {l.dancers}
                    </span>
                    <span className="feis-narrow text-right text-[24px] leading-none text-muted-foreground">
                      {l.entries}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
                <h2 className="feis-display text-[22px]">By competition</h2>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="feis-tick"
                      checked={showEmpty}
                      onChange={(e) => setShowEmpty(e.target.checked)}
                    />
                    Show competitions with no entries
                  </label>
                  <button
                    type="button"
                    onClick={() => exportToCsv(entries, numbers)}
                    className="feis-btn feis-btn-outline"
                  >
                    Download as a spreadsheet (CSV)
                  </button>
                </div>
              </div>
              <p className="mb-3 text-sm text-muted-foreground">
                Open a competition to see who&apos;s in it.
              </p>

              <div className="feis-entry-form">
                {groups.map((group, i) => (
                  <section key={group.label}>
                    <h3
                      className={`px-4 pt-2 pb-1 text-[12.5px] font-bold text-muted-foreground ${
                        i > 0 ? 'border-t-[1.5px] border-[var(--color-feis-charcoal)]' : ''
                      }`}
                    >
                      {group.label}
                    </h3>
                    {group.items.map(({ competition }) => {
                      const dancerIds = stats.dancersByCompetition.get(competition.id) ?? []
                      const sorted = [...dancerIds].sort(
                        (a, b) => (numbers[a] ?? 0) - (numbers[b] ?? 0)
                      )
                      return (
                        <details key={competition.id} className="group border-t border-[#E2DCCD]">
                          <summary
                            className={`list-none px-4 py-2 hover:bg-[var(--color-feis-green-light)] [&::-webkit-details-marker]:hidden ${
                              dancerIds.length === 0
                                ? 'pointer-events-none text-muted-foreground'
                                : 'cursor-pointer'
                            }`}
                          >
                            <div className="grid grid-cols-[14px_56px_minmax(0,1fr)_auto] items-center gap-2.5 sm:grid-cols-[14px_64px_minmax(0,1fr)_auto]">
                              <span
                                aria-hidden="true"
                                className="text-[10px] text-muted-foreground transition-transform group-open:rotate-90"
                              >
                                {dancerIds.length > 0 ? '▶' : ''}
                              </span>
                              <span className="feis-narrow text-[17px]">
                                {competition.display_code ?? ''}
                              </span>
                              <span className="min-w-0">{competitionName(competition)}</span>
                              <span className="feis-narrow text-[22px] leading-none tabular-nums">
                                {dancerIds.length}
                              </span>
                            </div>
                          </summary>
                          {sorted.length > 0 && (
                            <ul className="bg-[var(--color-feis-cream)] px-4 py-2">
                              {sorted.map((id) => {
                                const d = dancerById.get(id)
                                return (
                                  <li
                                    key={id}
                                    className="grid grid-cols-[14px_56px_minmax(0,1fr)] gap-2.5 py-1 text-sm sm:grid-cols-[14px_64px_minmax(0,1fr)]"
                                  >
                                    <span />
                                    <span className="feis-narrow text-[17px]">
                                      {numbers[id] ?? '–'}
                                    </span>
                                    <span>
                                      {d ? `${d.first_name} ${d.last_name}` : 'Dancer'}
                                      {d?.school_name && (
                                        <span className="text-muted-foreground">
                                          , {d.school_name}
                                        </span>
                                      )}
                                    </span>
                                  </li>
                                )
                              })}
                            </ul>
                          )}
                        </details>
                      )
                    })}
                  </section>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
