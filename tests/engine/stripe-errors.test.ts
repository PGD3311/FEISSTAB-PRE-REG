import { describe, expect, it } from 'vitest'
import { classifyStripeError } from '@/lib/engine/stripe-errors'

describe('classifyStripeError', () => {
  it('treats a key that is still being processed as in progress, whatever the error type', () => {
    expect(classifyStripeError({ type: 'StripeInvalidRequestError', code: 'idempotency_key_in_use', statusCode: 409 }))
      .toBe('in_progress')
    expect(classifyStripeError({ type: 'StripeIdempotencyError', statusCode: 409 })).toBe('in_progress')
  })
  it.each(['StripeConnectionError', 'StripeAPIError', 'StripeRateLimitError'])('treats %s as retry with the same key', (type) => {
    expect(classifyStripeError({ type })).toBe('retry')
  })
  it.each(['StripeInvalidRequestError', 'StripeCardError', 'StripeAuthenticationError', 'StripePermissionError', 'StripeIdempotencyError'])(
    'treats %s as a refusal of this one request', (type) => {
      expect(classifyStripeError({ type, statusCode: 400 })).toBe('rejected')
    })
  it('falls back to the status code, and treats anything unknown as retry', () => {
    expect(classifyStripeError({ statusCode: 503 })).toBe('retry')
    expect(classifyStripeError({ statusCode: 429 })).toBe('retry')
    expect(classifyStripeError({ statusCode: 400 })).toBe('rejected')
    expect(classifyStripeError(new Error('socket hang up'))).toBe('retry')
  })
})
