const TIMEZONE_LABELS: Record<string, string> = {
  'America/New_York': 'Eastern (New York)',
  'America/Chicago': 'Central (Chicago)',
  'America/Denver': 'Mountain (Denver)',
  'America/Los_Angeles': 'Pacific (Los Angeles)',
  'America/Anchorage': 'Alaska',
  'Pacific/Honolulu': 'Hawaii',
  'America/Toronto': 'Eastern (Toronto)',
  'Europe/Dublin': 'Ireland (Dublin)',
  'Europe/London': 'United Kingdom (London)',
  'Australia/Sydney': 'Australia (Sydney)',
}

export function formatTimezone(tz: string): string {
  return TIMEZONE_LABELS[tz] ?? tz
}

/** Parse a YYYY-MM-DD string as a local date (no timezone shift). */
export function parseLocalDate(dateString: string): Date {
  return new Date(dateString + 'T00:00:00')
}

/** Format cents as a dollar string (e.g., 1500 → "$15.00"). */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

/** Format cents or return a fallback for null values. */
export function formatCentsOrNull(cents: number | null, fallback = 'N/A'): string {
  if (cents === null || cents === undefined) return fallback
  return formatCents(cents)
}

/** Format a date-only string (YYYY-MM-DD) for display — timezone-safe. */
export function formatDate(
  dateString: string | null,
  options?: { weekday?: 'short' | 'long'; month?: 'short' | 'long'; fallback?: string }
): string {
  if (!dateString) return options?.fallback ?? ''
  const date = parseLocalDate(dateString)
  if (isNaN(date.getTime())) return options?.fallback ?? ''
  return date.toLocaleDateString('en-US', {
    weekday: options?.weekday,
    month: options?.month ?? 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Format an ISO timestamp for display (includes time). */
export function formatDateTime(isoString: string | null, fallback = ''): string {
  if (!isoString) return fallback
  const date = new Date(isoString)
  if (isNaN(date.getTime())) return fallback
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
