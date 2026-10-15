// Date helpers for "midnight on this date at the feis", whatever timezone the viewer is in.

function wallClockUtcMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date(instantMs))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
}

/** '2026-10-10' + 'America/New_York' → '2026-10-10T04:00:00.000Z' (midnight local time). */
export function startOfLocalDateIso(dateString: string, timeZone: string): string {
  const [y, m, d] = dateString.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d)
  let instant = guess - (wallClockUtcMs(guess, timeZone) - guess)
  // A second pass corrects the offset when a DST change falls between guess and instant
  instant = guess - (wallClockUtcMs(instant, timeZone) - instant)
  return new Date(instant).toISOString()
}

/** The last second of a local date, e.g. a registration deadline of 11:59:59 PM at the feis. */
export function endOfLocalDateIso(dateString: string, timeZone: string): string {
  const [y, m, d] = dateString.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  return new Date(new Date(startOfLocalDateIso(next, timeZone)).getTime() - 1000).toISOString()
}

/** The calendar date ('YYYY-MM-DD') an instant falls on in the given timezone. */
export function localDateString(isoString: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(isoString))
}
