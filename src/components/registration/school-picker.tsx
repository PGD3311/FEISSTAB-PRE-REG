'use client'

import { useEffect, useId, useState } from 'react'
import { addSchool, searchSchools, type SchoolOption } from '@/app/dashboard/dancers/actions'

interface SchoolPickerProps {
  value: { id: string | null; name: string }
  onChange: (value: { id: string | null; name: string }) => void
}

/**
 * Search the shared list of dance schools, or add one that's missing. The chosen school's name
 * is what's saved on the dancer, with a link to the list.
 */
export function SchoolPicker({ value, onChange }: SchoolPickerProps) {
  const inputId = useId()
  const listId = useId()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SchoolOption[]>([])
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chosen = value.name.trim().length > 0

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const result = await searchSchools(q)
        if (cancelled) return
        if ('error' in result) {
          setError(result.error)
          setResults([])
        } else {
          setError(null)
          setResults(result.schools)
        }
      } catch {
        if (!cancelled) setError('The school list could not be searched. Try again.')
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  async function handleAdd() {
    setAdding(true)
    setError(null)
    try {
      const result = await addSchool(query)
      if ('error' in result) {
        setError(result.error)
        return
      }
      onChange({ id: result.school.id, name: result.school.name })
      setQuery('')
    } catch {
      setError('The school could not be added. Try again.')
    } finally {
      setAdding(false)
    }
  }

  if (chosen) {
    return (
      <div>
        <span className="feis-label">School</span>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[3px] border-[1.5px] border-[var(--color-feis-charcoal)] bg-white px-3 py-2">
          <span className="font-semibold">{value.name}</span>
          <button
            type="button"
            onClick={() => onChange({ id: null, name: '' })}
            className="text-sm font-bold text-primary underline underline-offset-[3px]"
          >
            Change
          </button>
        </div>
      </div>
    )
  }

  const exactMatch = results.some((r) => r.name.toLowerCase() === query.trim().toLowerCase())

  return (
    <div>
      <label htmlFor={inputId} className="feis-label">
        School <span className="font-normal text-muted-foreground">(optional)</span>
      </label>
      <input
        id={inputId}
        type="search"
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Start typing the school's name"
        className="feis-input"
        aria-controls={listId}
        aria-describedby={`${inputId}-hint`}
      />
      <p id={`${inputId}-hint`} className="mt-1.5 text-[13px] text-muted-foreground">
        Pick it from the list. If it isn&apos;t there yet, add it.
      </p>

      {query.trim().length >= 2 && (
        <div
          id={listId}
          aria-live="polite"
          className="mt-2 rounded-[3px] border-[1.5px] border-[var(--color-feis-charcoal)] bg-white"
        >
          {searching && results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>
          ) : (
            <ul>
              {results.map((school, i) => (
                <li key={school.id} className={i > 0 ? 'border-t border-[#E2DCCD]' : ''}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange({ id: school.id, name: school.name })
                      setQuery('')
                    }}
                    className="block w-full px-3 py-2 text-left hover:bg-[var(--color-feis-green-light)] focus-visible:bg-[var(--color-feis-green-light)] focus-visible:outline-none"
                  >
                    {school.name}
                  </button>
                </li>
              ))}
              {!exactMatch && (
                <li
                  className={
                    results.length > 0 ? 'border-t-[1.5px] border-[var(--color-feis-charcoal)]' : ''
                  }
                >
                  <button
                    type="button"
                    onClick={handleAdd}
                    disabled={adding}
                    className="block w-full px-3 py-2 text-left font-semibold text-primary hover:bg-[var(--color-feis-green-light)] disabled:opacity-50"
                  >
                    {adding ? 'Adding…' : `Add “${query.trim()}” as a new school`}
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1.5 text-[13px] text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
