import { describe, expect, it } from 'vitest'
import { emailIsConfigured } from '@/lib/email/email-config'

const CONFIGURED = {
  RESEND_API_KEY: 're_test_123',
  EMAIL_FROM: 'RunFeis <entries@runfeis.com>',
  PAYMENTS_ALERT_EMAIL: 'daniel@example.com, steve@example.com'
}

describe('emailIsConfigured', () => {
  it('is on when Resend, the sender and the payments contacts are all set', () => {
    expect(emailIsConfigured(CONFIGURED)).toBe(true)
  })

  it('is off when any one of them is missing', () => {
    expect(emailIsConfigured({ ...CONFIGURED, RESEND_API_KEY: undefined })).toBe(false)
    expect(emailIsConfigured({ ...CONFIGURED, EMAIL_FROM: '' })).toBe(false)
    expect(emailIsConfigured({ ...CONFIGURED, PAYMENTS_ALERT_EMAIL: undefined })).toBe(false)
  })

  it('needs at least one real address among the payments contacts', () => {
    expect(emailIsConfigured({ ...CONFIGURED, PAYMENTS_ALERT_EMAIL: ' , ' })).toBe(false)
    const oneContact = { ...CONFIGURED, PAYMENTS_ALERT_EMAIL: 'steve@example.com' }
    expect(emailIsConfigured(oneContact)).toBe(true)
  })
})
