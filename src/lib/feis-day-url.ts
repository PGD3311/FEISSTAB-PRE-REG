const DEFAULT_FEIS_DAY_URL = 'https://feistab.vercel.app'

/** A feis-day address with no trailing slash, or the default when none is given */
export function normaliseFeisDayUrl(configured: string | undefined): string {
  const value = configured?.trim() || DEFAULT_FEIS_DAY_URL
  return value.replace(/\/+$/, '')
}

/** The feis-day app's address, from NEXT_PUBLIC_FEIS_DAY_URL */
export function feisDayBaseUrl(): string {
  return normaliseFeisDayUrl(process.env.NEXT_PUBLIC_FEIS_DAY_URL)
}

/** The feis-day dashboard page for a launched event */
export function feisDayEventUrl(eventId: string, baseUrl: string = feisDayBaseUrl()): string {
  return `${baseUrl}/dashboard/events/${encodeURIComponent(eventId)}`
}
