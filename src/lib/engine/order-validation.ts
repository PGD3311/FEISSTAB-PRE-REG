import { getEligibleCompetitions } from '@/lib/engine/eligibility'
import { parseLocalDate } from '@/lib/format'
import type {
  Dancer,
  DancerDanceLevel,
  DancerProfile,
  FeisCompetition,
  FeisListing,
  Level
} from '@/lib/types/feis-listing'

export type OrderListing = Pick<
  FeisListing,
  | 'status' | 'reg_opens_at' | 'reg_closes_at' | 'late_reg_closes_at' | 'age_cutoff_date'
  | 'feis_date' | 'terms_url'
> & { levels: Level[] }

export type OrderDancer = Pick<
  Dancer,
  | 'id' | 'household_id' | 'first_name' | 'last_name' | 'date_of_birth' | 'gender'
  | 'school_name' | 'school_id' | 'relationship' | 'tcrg_name' | 'championship_status' | 'is_active'
> & { dance_levels: Pick<DancerDanceLevel, 'dance_key' | 'level_key'>[] }

export interface RequestedEntry {
  dancerId: string
  competitionId: string
}

export interface OrderRequest {
  now: Date
  householdId: string
  listing: OrderListing
  dancers: OrderDancer[]
  /** Every competition of this feis, enabled or not */
  competitions: FeisCompetition[]
  entries: RequestedEntry[]
}

export type OrderValidation = { ok: true; ageCutoffDate: Date } | { ok: false; error: string }

/**
 * The date ages are counted on: the listing's cutoff date if it has one, otherwise January 1 of
 * the feis year (feis age is a dancer's age on January 1), or of `now`'s year if the feis has no
 * date either. The entry page counts ages the same way.
 */
export function ageCutoffDateFor(listing: Pick<FeisListing, 'age_cutoff_date' | 'feis_date'>, now: Date): Date {
  if (listing.age_cutoff_date) return parseLocalDate(listing.age_cutoff_date)
  const year = listing.feis_date
    ? parseLocalDate(listing.feis_date).getFullYear()
    : now.getFullYear()
  return new Date(year, 0, 1)
}

/** When registration closes: the late deadline if there is one, otherwise the normal one. */
export function registrationCloseTime(
  listing: Pick<FeisListing, 'reg_closes_at' | 'late_reg_closes_at'>
): Date | null {
  const close = listing.late_reg_closes_at ?? listing.reg_closes_at
  return close ? new Date(close) : null
}

export function toDancerProfile(dancer: OrderDancer): DancerProfile {
  const danceLevels: Record<string, string> = {}
  for (const level of dancer.dance_levels) danceLevels[level.dance_key] = level.level_key
  return {
    dob: parseLocalDate(dancer.date_of_birth),
    gender: dancer.gender,
    championshipStatus: dancer.championship_status,
    danceLevels
  }
}

function fail(error: string): OrderValidation {
  return { ok: false, error }
}

/** Submit's checks (spec §4): the feis is open, and every entry is this family's and eligible. */
export function validateOrderRequest(request: OrderRequest): OrderValidation {
  const { listing, now } = request

  if (listing.status !== 'open') return fail('Registration for this feis is not open.')
  if (listing.reg_opens_at && now < new Date(listing.reg_opens_at)) {
    return fail('Registration for this feis has not opened yet.')
  }
  const close = registrationCloseTime(listing)
  if (close && now > close) return fail('Registration for this feis has closed.')

  if (request.entries.length === 0) return fail('Choose at least one competition.')

  const seen = new Set<string>()
  for (const entry of request.entries) {
    const key = `${entry.dancerId}:${entry.competitionId}`
    if (seen.has(key)) return fail('The same competition is listed twice for one dancer.')
    seen.add(key)
  }

  const dancers = new Map(request.dancers.map((d) => [d.id, d]))
  const competitions = new Map(request.competitions.map((c) => [c.id, c]))

  for (const entry of request.entries) {
    const dancer = dancers.get(entry.dancerId)
    if (!dancer || dancer.household_id !== request.householdId) {
      return fail('One or more dancers do not belong to your family.')
    }
    if (!dancer.is_active) return fail(`${dancer.first_name} is no longer active on your account.`)
    const competition = competitions.get(entry.competitionId)
    if (!competition || !competition.enabled) return fail('One or more competitions are not available.')
  }

  const ageCutoffDate = ageCutoffDateFor(listing, now)
  const chosenByDancer = new Map<string, Set<string>>()
  for (const entry of request.entries) {
    const chosen = chosenByDancer.get(entry.dancerId) ?? new Set<string>()
    chosen.add(entry.competitionId)
    chosenByDancer.set(entry.dancerId, chosen)
  }
  for (const [dancerId, chosen] of chosenByDancer) {
    const dancer = dancers.get(dancerId)!
    // Judged against the feis's whole listing, as the entry page does: a dancer's own age group
    // only shows up when the older groups they could enter are in the list too. Every chosen
    // competition is enabled (checked above), so each one has a result.
    const blocked = getEligibleCompetitions(
      toDancerProfile(dancer),
      request.competitions,
      ageCutoffDate,
      listing.levels
    ).find((result) => chosen.has(result.competition.id) && !result.eligible)
    if (blocked) {
      return fail(
        `${dancer.first_name} ${dancer.last_name} can't enter ${blocked.competition.display_name}: ${blocked.reason}.`
      )
    }
  }

  return { ok: true, ageCutoffDate }
}
