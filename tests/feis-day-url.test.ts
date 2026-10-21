import { afterEach, describe, expect, it, vi } from 'vitest'

import { feisDayBaseUrl, feisDayEventUrl, normaliseFeisDayUrl } from '@/lib/feis-day-url'

describe('normaliseFeisDayUrl', () => {
  it('falls back to the RunFeis feis-day site when nothing is set', () => {
    expect(normaliseFeisDayUrl(undefined)).toBe('https://feistab.vercel.app')
    expect(normaliseFeisDayUrl('')).toBe('https://feistab.vercel.app')
    expect(normaliseFeisDayUrl('   ')).toBe('https://feistab.vercel.app')
  })

  it('uses the configured address', () => {
    expect(normaliseFeisDayUrl('https://day.runfeis.com')).toBe('https://day.runfeis.com')
  })

  it('trims trailing slashes', () => {
    expect(normaliseFeisDayUrl('https://day.runfeis.com/')).toBe('https://day.runfeis.com')
    expect(normaliseFeisDayUrl('https://day.runfeis.com//')).toBe('https://day.runfeis.com')
  })
})

describe('feisDayBaseUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reads NEXT_PUBLIC_FEIS_DAY_URL', () => {
    vi.stubEnv('NEXT_PUBLIC_FEIS_DAY_URL', 'https://day.runfeis.com/')
    expect(feisDayBaseUrl()).toBe('https://day.runfeis.com')
  })

  it('falls back when NEXT_PUBLIC_FEIS_DAY_URL is empty', () => {
    vi.stubEnv('NEXT_PUBLIC_FEIS_DAY_URL', '')
    expect(feisDayBaseUrl()).toBe('https://feistab.vercel.app')
  })
})

describe('feisDayEventUrl', () => {
  it('links to the event dashboard', () => {
    expect(feisDayEventUrl('abc-123', 'https://day.runfeis.com')).toBe(
      'https://day.runfeis.com/dashboard/events/abc-123'
    )
  })
})
