import { describe, it, expect } from 'vitest'
import { isHouseholdComplete } from '@/lib/household'

const COMPLETE = {
  first_name: 'Mary',
  last_name: 'Murphy',
  phone: '555-0100',
  address_line1: '1 Main St',
  city: 'Newport',
  state_region: 'RI',
  postal_code: '02840',
}

describe('isHouseholdComplete', () => {
  it('true when name, phone and address are filled in', () => {
    expect(isHouseholdComplete(COMPLETE)).toBe(true)
  })

  it('false when any required field is missing', () => {
    expect(isHouseholdComplete({ ...COMPLETE, phone: null })).toBe(false)
    expect(isHouseholdComplete({ ...COMPLETE, postal_code: null })).toBe(false)
  })

  it('treats blank text as missing', () => {
    expect(isHouseholdComplete({ ...COMPLETE, last_name: '   ' })).toBe(false)
  })
})
