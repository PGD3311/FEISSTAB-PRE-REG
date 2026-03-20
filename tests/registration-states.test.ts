import { describe, it, expect } from 'vitest'
import {
  canTransitionRegistration,
  getNextRegistrationStates
} from '@/lib/registration-states'

describe('canTransitionRegistration', () => {
  // ─── Valid transitions ───
  it('allows draft → pending_payment', () => {
    expect(canTransitionRegistration('draft', 'pending_payment')).toBe(true)
  })
  it('allows draft → cancelled', () => {
    expect(canTransitionRegistration('draft', 'cancelled')).toBe(true)
  })
  it('allows draft → expired', () => {
    expect(canTransitionRegistration('draft', 'expired')).toBe(true)
  })
  it('allows pending_payment → paid', () => {
    expect(canTransitionRegistration('pending_payment', 'paid')).toBe(true)
  })
  it('allows pending_payment → expired', () => {
    expect(canTransitionRegistration('pending_payment', 'expired')).toBe(true)
  })
  it('allows pending_payment → cancelled', () => {
    expect(canTransitionRegistration('pending_payment', 'cancelled')).toBe(true)
  })

  // ─── Invalid transitions ───
  it('rejects draft → paid (must go through pending_payment)', () => {
    expect(canTransitionRegistration('draft', 'paid')).toBe(false)
  })
  it('rejects paid → anything (terminal state)', () => {
    expect(canTransitionRegistration('paid', 'draft')).toBe(false)
    expect(canTransitionRegistration('paid', 'pending_payment')).toBe(false)
    expect(canTransitionRegistration('paid', 'expired')).toBe(false)
    expect(canTransitionRegistration('paid', 'cancelled')).toBe(false)
  })
  it('rejects expired → anything (terminal state)', () => {
    expect(canTransitionRegistration('expired', 'draft')).toBe(false)
    expect(canTransitionRegistration('expired', 'pending_payment')).toBe(false)
    expect(canTransitionRegistration('expired', 'paid')).toBe(false)
    expect(canTransitionRegistration('expired', 'cancelled')).toBe(false)
  })
  it('rejects cancelled → anything (terminal state)', () => {
    expect(canTransitionRegistration('cancelled', 'draft')).toBe(false)
    expect(canTransitionRegistration('cancelled', 'pending_payment')).toBe(false)
    expect(canTransitionRegistration('cancelled', 'paid')).toBe(false)
    expect(canTransitionRegistration('cancelled', 'expired')).toBe(false)
  })
  it('rejects same-state transitions', () => {
    expect(canTransitionRegistration('draft', 'draft')).toBe(false)
    expect(canTransitionRegistration('pending_payment', 'pending_payment')).toBe(false)
    expect(canTransitionRegistration('paid', 'paid')).toBe(false)
  })
  it('rejects pending_payment → draft (no back-transitions)', () => {
    expect(canTransitionRegistration('pending_payment', 'draft')).toBe(false)
  })
})

describe('getNextRegistrationStates', () => {
  it('returns [pending_payment, cancelled, expired] for draft', () => {
    const result = getNextRegistrationStates('draft')
    expect(result).toContain('pending_payment')
    expect(result).toContain('cancelled')
    expect(result).toContain('expired')
    expect(result).toHaveLength(3)
  })
  it('returns [paid, expired, cancelled] for pending_payment', () => {
    const result = getNextRegistrationStates('pending_payment')
    expect(result).toContain('paid')
    expect(result).toContain('expired')
    expect(result).toContain('cancelled')
    expect(result).toHaveLength(3)
  })
  it('returns [] for paid (terminal)', () => {
    expect(getNextRegistrationStates('paid')).toEqual([])
  })
  it('returns [] for expired (terminal)', () => {
    expect(getNextRegistrationStates('expired')).toEqual([])
  })
  it('returns [] for cancelled (terminal)', () => {
    expect(getNextRegistrationStates('cancelled')).toEqual([])
  })
})
