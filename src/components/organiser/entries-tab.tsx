'use client'

import { useEffect, useState } from 'react'

import { getFeisEntries } from '@/app/organiser/feiseanna/actions'
import { formatCents } from '@/lib/format'

interface EntryRow {
  id: string
  fee_category: string
  base_fee_cents: number
  late_fee_cents: number
  created_at: string
  dancer_id: string
  dancers: {
    first_name: string
    last_name: string
    school_name: string | null
    date_of_birth: string
    gender: string
  }
  feis_competitions: {
    display_name: string
    age_group_key: string | null
  }
  registrations: {
    status: string
    confirmation_number: string | null
    total_cents: number
    created_at: string
  }
}

interface EntrySummary {
  totalDancers: number
  totalEntries: number
  revenueCents: number
  pendingCount: number
}

const STATUS_TAGS: Record<string, { label: string; className: string }> = {
  paid: {
    label: 'Paid',
    className: 'bg-[var(--color-feis-green-light)] text-[var(--color-feis-green)]'
  },
  pending_payment: {
    label: 'Waiting for payment',
    className: 'bg-[var(--color-feis-orange-light)] text-[var(--color-feis-orange-ink)]'
  },
  draft: {
    label: 'Not finished',
    className: 'bg-[var(--color-feis-cream-dark)] text-muted-foreground'
  },
  expired: {
    label: 'Expired',
    className: 'bg-[var(--color-feis-cream-dark)] text-muted-foreground'
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-[var(--color-feis-cream-dark)] text-muted-foreground'
  }
}

function StatusTag({ status }: { status: string }) {
  const tag = STATUS_TAGS[status]
  return (
    <span
      className={`inline-block rounded-[2px] px-1.5 py-0.5 text-xs font-bold whitespace-nowrap ${tag?.className ?? 'bg-[var(--color-feis-cream-dark)] text-muted-foreground'}`}
    >
      {tag?.label ?? status}
    </span>
  )
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

function exportToCsv(entries: EntryRow[]) {
  const headers = [
    'Dancer First Name',
    'Dancer Last Name',
    'School',
    'Competition',
    'Fee Category',
    'Status',
    'Confirmation #'
  ]

  const rows = entries.map((e) => [
    e.dancers.first_name,
    e.dancers.last_name,
    e.dancers.school_name ?? '',
    e.feis_competitions.display_name,
    e.fee_category,
    e.registrations.status,
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
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      {summary && (
        <aside className="feis-receipt px-[18px] pt-5 pb-[18px] lg:sticky lg:top-6 lg:order-2">
          <h2 className="feis-display text-[22px]">Entries so far</h2>
          <p className="mb-3 text-[13px] text-muted-foreground">Counts every entry, paid or not</p>
          <CountLine label="Dancers" value={summary.totalDancers} />
          <CountLine label="Entries" value={summary.totalEntries} />
          <CountLine label="Unpaid registrations" value={summary.pendingCount} />
          <div className="mt-2.5 flex items-baseline justify-between border-t-[3px] border-[var(--color-feis-gold)] pt-2.5">
            <span className="font-bold">Paid so far</span>
            <strong className="feis-narrow text-[40px] leading-none tabular-nums">
              {formatCents(summary.revenueCents)}
            </strong>
          </div>
        </aside>
      )}

      <section className="min-w-0 lg:order-1">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="feis-display text-[22px]">Who&apos;s entered</h2>
          {entries.length > 0 && (
            <button
              type="button"
              onClick={() => exportToCsv(entries)}
              className="feis-btn feis-btn-outline"
            >
              Download as a spreadsheet (CSV)
            </button>
          )}
        </div>

        {entries.length === 0 ? (
          <div className="feis-sticker max-w-xl rounded px-5 py-5">
            <p className="font-bold">No entries yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Entries appear here as soon as a family starts registering.
            </p>
          </div>
        ) : (
          <div className="feis-entry-form overflow-x-auto">
            <table className="w-full">
              <thead className="feis-thead">
                <tr>
                  <th>Dancer</th>
                  <th>School</th>
                  <th>Competition</th>
                  <th>Status</th>
                  <th>Confirmation</th>
                </tr>
              </thead>
              <tbody className="feis-tbody">
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-4 py-2.5 text-sm font-bold">
                      {entry.dancers.first_name} {entry.dancers.last_name}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">
                      {entry.dancers.school_name ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-sm">{entry.feis_competitions.display_name}</td>
                    <td className="px-4 py-2.5 text-sm">
                      <StatusTag status={entry.registrations.status} />
                    </td>
                    <td className="feis-narrow px-4 py-2.5 text-[15px]">
                      {entry.registrations.confirmation_number ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
