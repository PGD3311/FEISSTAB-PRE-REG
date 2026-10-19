import { describe, expect, it } from 'vitest'
import { classifyEmailError } from '@/lib/engine/email-errors'

describe('classifyEmailError', () => {
  it('treats a refusal as nothing sent', () => {
    expect(classifyEmailError({ statusCode: 422, name: 'validation_error' })).toBe('rejected')
    expect(classifyEmailError({ statusCode: 429, name: 'rate_limit_exceeded' })).toBe('rejected')
  })
  it('treats server errors, in-progress keys and unknowns as maybe sent', () => {
    expect(classifyEmailError({ statusCode: 500, name: 'application_error' })).toBe('uncertain')
    expect(classifyEmailError({ statusCode: 409, name: 'concurrent_idempotent_requests' })).toBe(
      'uncertain'
    )
    expect(classifyEmailError({ statusCode: null, name: 'application_error' })).toBe('uncertain')
    expect(classifyEmailError(null)).toBe('uncertain')
  })
})
