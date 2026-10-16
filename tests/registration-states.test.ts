import { describe, it, expect } from 'vitest'
import {
  REGISTRATION_TRANSITIONS,
  canTransitionRegistration,
  getNextRegistrationStates
} from '@/lib/registration-states'

describe('canTransitionRegistration', () => {
  it.each([
    ['draft', 'pending_payment'],
    ['draft', 'cancelled'],
    ['draft', 'expired'],
    ['draft', 'paid'],
    ['pending_payment', 'paid'],
    ['pending_payment', 'expired'],
    ['pending_payment', 'cancelled'],
    ['expired', 'paid'],
  ] as const)('allows %s → %s', (from, to) => {
    expect(canTransitionRegistration(from, to)).toBe(true)
  })

  it('treats paid and cancelled as final', () => {
    for (const to of ['draft', 'pending_payment', 'paid', 'expired', 'cancelled'] as const) {
      expect(canTransitionRegistration('paid', to)).toBe(false)
      expect(canTransitionRegistration('cancelled', to)).toBe(false)
    }
  })

  it('only lets an expired order become paid', () => {
    expect(canTransitionRegistration('expired', 'draft')).toBe(false)
    expect(canTransitionRegistration('expired', 'pending_payment')).toBe(false)
    expect(canTransitionRegistration('expired', 'cancelled')).toBe(false)
  })

  it('never moves backwards to draft', () => {
    expect(canTransitionRegistration('pending_payment', 'draft')).toBe(false)
    expect(canTransitionRegistration('draft', 'draft')).toBe(false)
  })
})

describe('getNextRegistrationStates', () => {
  it('lists the moves from each state', () => {
    expect(getNextRegistrationStates('draft').sort()).toEqual(['cancelled', 'expired', 'paid', 'pending_payment'])
    expect(getNextRegistrationStates('pending_payment').sort()).toEqual(['cancelled', 'expired', 'paid'])
    expect(getNextRegistrationStates('expired')).toEqual(['paid'])
    expect(getNextRegistrationStates('paid')).toEqual([])
    expect(getNextRegistrationStates('cancelled')).toEqual([])
  })

  it('is backed by the exported table', () => {
    expect(getNextRegistrationStates('draft')).toBe(REGISTRATION_TRANSITIONS.draft)
  })
})
