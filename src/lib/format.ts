import type { LateFeeTier } from '@/lib/types/feis-listing'

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
  'Australia/Sydney': 'Australia (Sydney)'
}

export function formatTimezone(tz: string): string {
  return TIMEZONE_LABELS[tz] ?? tz
}

/** Parse a YYYY-MM-DD string as a local date (no timezone shift). */
export function parseLocalDate(dateString: string): Date {
  return new Date(dateString + 'T00:00:00')
}

/** Format cents as a dollar string (e.g., 1500 → "$15.00"). */
/** e.g. 312500 → "$3,125.00"; whole-cent integer math, so no float rounding. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.round(cents))
  const dollars = Math.floor(abs / 100).toLocaleString('en-US')
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`
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
    year: 'numeric'
  })
}

/** Format an ISO timestamp for display (includes time), in the feis's time zone when given. */
export function formatDateTime(
  isoString: string | null,
  fallback = '',
  timeZone?: string | null
): string {
  if (!isoString) return fallback
  const date = new Date(isoString)
  if (isNaN(date.getTime())) return fallback
  return date.toLocaleDateString('en-US', {
    timeZone: timeZone ?? undefined,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

/** e.g. "$25.00 per dancer from Oct 10 (max $50.00 per family)" */
export function formatLateTier(tier: LateFeeTier, timeZone: string): string {
  const from = new Date(tier.starts_at).toLocaleDateString('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric'
  })
  const max =
    tier.family_max_cents === null ? '' : ` (max ${formatCents(tier.family_max_cents)} per family)`
  return `${formatCents(tier.fee_cents)} per dancer from ${from}${max}`
}

/** Late tiers in the order they start. */
export function sortLateTiers(tiers: LateFeeTier[]): LateFeeTier[] {
  return [...tiers].sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
  )
}

/** An organiser's website as a link, adding https:// when they typed a bare domain. */
export function websiteHref(url: string): string {
  return url.startsWith('http') ? url : `https://${url}`
}

/** e.g. "goodwinfeis.com" for https://www.goodwinfeis.com/entries */
export function siteName(url: string): string {
  try {
    return new URL(websiteHref(url)).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
