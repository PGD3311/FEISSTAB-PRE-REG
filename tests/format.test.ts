import { describe, it, expect } from 'vitest'
import { formatCents, formatDateTime, siteName, websiteHref } from '@/lib/format'

describe('formatCents', () => {
  it('formats dollars and cents with thousands separators', () => {
    expect(formatCents(1500)).toBe('$15.00')
    expect(formatCents(312500)).toBe('$3,125.00')
    expect(formatCents(123456789)).toBe('$1,234,567.89')
    expect(formatCents(5)).toBe('$0.05')
    expect(formatCents(0)).toBe('$0.00')
  })

  it('puts the minus sign before the dollar sign', () => {
    expect(formatCents(-2500)).toBe('-$25.00')
  })
})

describe('websiteHref and siteName', () => {
  it('adds https to a bare domain and keeps a full link', () => {
    expect(websiteHref('goodwinfeis.com')).toBe('https://goodwinfeis.com')
    expect(websiteHref('http://goodwinfeis.com')).toBe('http://goodwinfeis.com')
  })

  it('shows just the host, without www', () => {
    expect(siteName('https://www.goodwinfeis.com/entries')).toBe('goodwinfeis.com')
    expect(siteName('goodwinfeis.com')).toBe('goodwinfeis.com')
  })
})

describe('formatDateTime', () => {
  it('shows a deadline in the feis time zone, not UTC', () => {
    const closes = '2027-03-02T04:59:00.000Z' // 11:59 pm on 1 March in New York
    expect(formatDateTime(closes, '', 'America/New_York')).toBe('March 1, 2027 at 11:59 PM')
    expect(formatDateTime(closes, '', 'UTC')).toBe('March 2, 2027 at 4:59 AM')
  })

  it('returns the fallback for a missing or invalid time', () => {
    expect(formatDateTime(null, 'Not set', 'America/New_York')).toBe('Not set')
    expect(formatDateTime('nonsense', 'Not set')).toBe('Not set')
  })
})
