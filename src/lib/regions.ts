/**
 * Where an organiser runs feiseanna, and the region that sanctioned a feis: the IDTANA regions,
 * the two closest to RunFeis first, then everything else.
 */
export const REGIONS = [
  'Mid-Atlantic',
  'New England',
  'Southern',
  'Mid-America',
  'Western',
  'Eastern Canada',
  'Western Canada',
  'Other (non-IDTANA)'
] as const

export type Region = (typeof REGIONS)[number]

/** True when the value is exactly one of the listed regions */
export function isRegion(value: string | null | undefined): value is Region {
  return (REGIONS as readonly string[]).includes(value ?? '')
}
