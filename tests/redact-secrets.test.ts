import { describe, it, expect } from 'vitest'
import { redactSecrets, safeErrorMessage } from '@/lib/redact-secrets'

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
