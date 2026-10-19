import { describe, expect, it } from 'vitest'
import { clientIpFrom } from '@/lib/engine/consent'

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null })

describe('clientIpFrom', () => {
  it('takes the first address from x-forwarded-for', () => {
    expect(clientIpFrom(headers({ 'x-forwarded-for': ' 203.0.113.7 , 10.0.0.1' }))).toBe('203.0.113.7')
  })
  it('falls back to x-real-ip', () => {
    expect(clientIpFrom(headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
  })
  it('returns null when neither header is present', () => {
    expect(clientIpFrom(headers({}))).toBeNull()
  })
})
