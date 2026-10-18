import { describe, it, expect } from 'vitest'
import { formatCents, siteName, websiteHref } from '@/lib/format'

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
