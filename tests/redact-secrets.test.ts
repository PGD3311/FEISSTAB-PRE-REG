import { describe, it, expect } from 'vitest'
import { redactSecrets, safeErrorMessage, redactWithEnv } from '@/lib/redact-secrets'

const FAKE_JWT = 'eyJhbGciOiJub25lIn0.eyJ0ZXN0IjoxfQ.fake'

describe('redactSecrets', () => {
  it('redacts a JWT inside an error message', () => {
    const msg = `Failed: TypeError: Headers.set: "${FAKE_JWT}" is an invalid header value`
    const out = redactSecrets(msg)
    expect(out).not.toContain('eyJ')
    expect(out).toContain('[redacted]')
    expect(out).toContain('is an invalid header value')
  })

  it('redacts sb_secret and Stripe keys', () => {
    expect(redactSecrets('key sb_secret_abc123 here')).toBe('key [redacted] here')
    expect(redactSecrets('a sk_live_abc and sk_test_def')).toBe('a [redacted] and [redacted]')
  })

  it('redacts every occurrence', () => {
    expect(redactSecrets(`${FAKE_JWT} ${FAKE_JWT}`)).toBe('[redacted] [redacted]')
  })

  it('leaves ordinary text alone', () => {
    expect(redactSecrets('duplicate key value violates unique constraint')).toBe(
      'duplicate key value violates unique constraint'
    )
  })
})

describe('safeErrorMessage', () => {
  it('redacts an Error message and handles non-errors', () => {
    expect(safeErrorMessage(new Error(`bad ${FAKE_JWT}`))).toBe('bad [redacted]')
    expect(safeErrorMessage('oops')).toBe('unknown error')
  })
})

describe('redactSecrets, live failure shapes', () => {
  it('redacts the quoted value after Headers.set', () => {
    const out = redactSecrets(
      'TypeError: Headers.set: "some opaque thing" is an invalid header value'
    )
    expect(out).toBe('TypeError: Headers.set: "[redacted]" is an invalid header value')
  })

  it('redacts a JWT with a space inside it', () => {
    const out = redactSecrets(
      'bad eyJhbGciOiJub25lIn0.eyJ0ZXN0IjoxfQ.fakeVy dmljZXJvbGU1SIG failed'
    )
    expect(out).toBe('bad [redacted] failed')
  })

  it('redacts a JWT with a newline in its signature', () => {
    const out = redactSecrets('bad eyJhbGciOiJub25lIn0.eyJ0ZXN0IjoxfQ.abcDEF12\nghiJKL34 end')
    expect(out).toBe('bad [redacted] end')
  })

  it('redacts sb_secret with a space inside it', () => {
    expect(redactSecrets('k sb_secret_abcd efgh1234 done')).toBe('k [redacted] done')
  })

  it('redacts rk_ and whsec_ values', () => {
    expect(redactSecrets('rk_live_abc whsec_def rk_test_x')).toBe(
      '[redacted] [redacted] [redacted]'
    )
  })

  it('redacts exact known values, including ones with whitespace inside', () => {
    const key = 'plainsecret 12345678'
    expect(redactSecrets(`oops ${key} and plainsecret12345678`, [key])).toBe(
      'oops [redacted] and [redacted]'
    )
  })

  it('redactWithEnv removes the live env key value', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'not-a-jwt-just-a-fake-value'
    try {
      expect(redactWithEnv('x not-a-jwt-just-a-fake-value y')).toBe('x [redacted] y')
    } finally {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY
    }
  })
})
