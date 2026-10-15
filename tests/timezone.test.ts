import { describe, it, expect } from 'vitest'
import { startOfLocalDateIso, endOfLocalDateIso, localDateString } from '@/lib/timezone'

describe('startOfLocalDateIso', () => {
  it('New York in daylight time is UTC-4', () => {
    expect(startOfLocalDateIso('2026-10-10', 'America/New_York')).toBe('2026-10-10T04:00:00.000Z')
  })

  it('New York in standard time is UTC-5', () => {
    expect(startOfLocalDateIso('2026-12-01', 'America/New_York')).toBe('2026-12-01T05:00:00.000Z')
  })

  it('the day clocks go back still starts at local midnight', () => {
    expect(startOfLocalDateIso('2026-11-01', 'America/New_York')).toBe('2026-11-01T04:00:00.000Z')
  })

  it('Dublin in summer is UTC+1', () => {
    expect(startOfLocalDateIso('2026-07-01', 'Europe/Dublin')).toBe('2026-06-30T23:00:00.000Z')
  })

  it('UTC is unchanged', () => {
    expect(startOfLocalDateIso('2026-10-10', 'UTC')).toBe('2026-10-10T00:00:00.000Z')
  })
})

describe('localDateString', () => {
  it('round-trips with startOfLocalDateIso', () => {
    const iso = startOfLocalDateIso('2026-10-12', 'America/Chicago')
    expect(localDateString(iso, 'America/Chicago')).toBe('2026-10-12')
  })

  it('an instant late in the UTC day can still be the previous local date', () => {
    expect(localDateString('2026-10-10T02:00:00Z', 'America/New_York')).toBe('2026-10-09')
  })
})

describe('endOfLocalDateIso', () => {
  it('is 11:59:59 PM local time', () => {
    expect(endOfLocalDateIso('2026-06-01', 'America/New_York')).toBe('2026-06-02T03:59:59.000Z')
  })

  it('works across a month end', () => {
    expect(endOfLocalDateIso('2026-10-31', 'America/Chicago')).toBe('2026-11-01T04:59:59.000Z')
  })

  it('falls on the same local date', () => {
    expect(localDateString(endOfLocalDateIso('2026-12-31', 'Europe/Dublin'), 'Europe/Dublin')).toBe(
      '2026-12-31'
    )
  })
})
