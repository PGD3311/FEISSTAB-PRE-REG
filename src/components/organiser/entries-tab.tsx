'use client'

import { useEffect, useState } from 'react'

import { getFeisEntries } from '@/app/organiser/feiseanna/actions'

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

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    paid: 'bg-secondary text-primary',
    pending_payment: 'bg-yellow-100 text-yellow-800',
    draft: 'bg-muted text-muted-foreground',
    expired: 'bg-destructive/10 text-destructive',
    cancelled: 'bg-muted text-muted-foreground',
  }

  const labels: Record<string, string> = {
    paid: 'Paid',
    pending_payment: 'Pending',
    draft: 'Draft',
    expired: 'Expired',
    cancelled: 'Cancelled',
  }

  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? 'bg-muted text-muted-foreground'}`}
    >
      {labels[status] ?? status}
    </span>
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
    'Confirmation #',
  ]

  const rows = entries.map(e => [
    e.dancers.first_name,
    e.dancers.last_name,
    e.dancers.school_name ?? '',
    e.feis_competitions.display_name,
    e.fee_category,
    e.registrations.status,
    e.registrations.confirmation_number ?? '',
  ])

  const csvContent = [
    headers.join(','),
    ...rows.map(row =>
      row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ),
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
      const result = await getFeisEntries(listingId)
      if ('error' in result) {
        setError(result.error ?? 'Unknown error')
      } else {
        setEntries(result.entries as unknown as EntryRow[])
        setSummary(result.summary)
      }
      setLoading(false)
    }
    load()
  }, [listingId])

  if (loading) {
    return (
      <div className="feis-card px-6 py-12 text-center text-muted-foreground">
        Loading entries...
      </div>
    )
  }

  if (error) {
    return (
      <div className="feis-card px-6 py-12 text-center text-destructive">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      {summary && (
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="feis-card p-5">
            <p className="text-sm text-muted-foreground">Total Dancers</p>
            <p className="feis-stat mt-1">{summary.totalDancers}</p>
          </div>
          <div className="feis-card p-5">
            <p className="text-sm text-muted-foreground">Total Entries</p>
            <p className="feis-stat mt-1">{summary.totalEntries}</p>
          </div>
          <div className="feis-card p-5">
            <p className="text-sm text-muted-foreground">Revenue (Paid)</p>
            <p className="feis-stat mt-1">{formatCents(summary.revenueCents)}</p>
          </div>
          <div className="feis-card p-5">
            <p className="text-sm text-muted-foreground">Pending</p>
            <p className="feis-stat mt-1">{summary.pendingCount}</p>
          </div>
        </div>
      )}

      {/* Actions */}
      {entries.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={() => exportToCsv(entries)}
            className="rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-muted"
          >
            Export CSV
          </button>
        </div>
      )}

      {/* Entries table */}
      {entries.length === 0 ? (
        <div className="feis-card px-6 py-12 text-center text-muted-foreground">
          No entries yet.
        </div>
      ) : (
        <div className="feis-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="feis-thead">
                <tr>
                  <th className="text-left">Dancer Name</th>
                  <th className="text-left">School</th>
                  <th className="text-left">Competition</th>
                  <th className="text-left">Status</th>
                  <th className="text-left">Confirmation #</th>
                </tr>
              </thead>
              <tbody className="feis-tbody">
                {entries.map(entry => (
                  <tr key={entry.id}>
                    <td className="px-4 py-3 text-sm font-medium">
                      {entry.dancers.first_name} {entry.dancers.last_name}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {entry.dancers.school_name ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {entry.feis_competitions.display_name}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <StatusBadge status={entry.registrations.status} />
                    </td>
                    <td className="px-4 py-3 font-mono text-sm">
                      {entry.registrations.confirmation_number ?? '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
