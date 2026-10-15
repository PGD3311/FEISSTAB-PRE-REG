import type { Household } from '@/lib/types/feis-listing'

export const REQUIRED_HOUSEHOLD_FIELDS = [
  'first_name',
  'last_name',
  'phone',
  'address_line1',
  'city',
  'state_region',
  'postal_code',
] as const

/** A family can register once the account holder's name, phone and address are filled in. */
export function isHouseholdComplete(
  household: Pick<Household, (typeof REQUIRED_HOUSEHOLD_FIELDS)[number]>
): boolean {
  return REQUIRED_HOUSEHOLD_FIELDS.every((field) => (household[field] ?? '').trim() !== '')
}
