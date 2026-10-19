import { getEligibleCompetitions } from '@/lib/engine/eligibility'
import { parseLocalDate } from '@/lib/format'
import type {
  CountedOrder,
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
  /** The family's paid orders for this feis: their dances can't be entered again */
  paidOrders?: CountedOrder[]
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

/** Why registration isn't taking orders right now, or null when it is */
export type RegistrationWindowBlock = 'not_open' | 'not_yet_open' | 'closed'

type RegistrationWindowListing = Pick<
  FeisListing,
  'status' | 'reg_opens_at' | 'reg_closes_at' | 'late_reg_closes_at'
>

/**
 * Whether registration is taking orders at `now`: the listing is open, has opened, and hasn't
 * passed its close time (the late deadline when there is one). The one check behind both
 * canStartOrder and validateOrderRequest, so the two can't disagree.
 */
export function registrationWindowBlock(
  listing: RegistrationWindowListing,
  now: Date
): RegistrationWindowBlock | null {
  if (listing.status !== 'open') return 'not_open'
  if (listing.reg_opens_at && now < new Date(listing.reg_opens_at)) return 'not_yet_open'
  const close = registrationCloseTime(listing)
  if (close && now > close) return 'closed'
  return null
}

/** Whether a new order can start: a family's first order or an add-on (spec §14, Decision 13) */
export interface OrderStartInput {
  listing: RegistrationWindowListing
  now: Date
  /** The family holds a draft or pending_payment order for this feis */
  hasUnpaidOrder: boolean
  /** The family has an open message-A case for this feis: message A says not to pay again */
  hasOpenMessageA: boolean
}

/**
 * The one gate for starting a new order, used for choosing dances and Pay on the entry page and for
 * Add dances on My entries and the paid receipt. False while registration isn't open, before it
 * opens, after it closes, while the family holds an unpaid order, or while message A is open.
 */
export function canStartOrder(input: OrderStartInput): boolean {
  if (registrationWindowBlock(input.listing, input.now) !== null) return false
  return !input.hasUnpaidOrder && !input.hasOpenMessageA
}

function fail(error: string): OrderValidation {
  return { ok: false, error }
}

/** Submit's checks (spec §4): the feis is open, and every entry is this family's and eligible. */
export function validateOrderRequest(request: OrderRequest): OrderValidation {
  const { listing, now } = request

  const windowBlock = registrationWindowBlock(listing, now)
  if (windowBlock === 'not_open') return fail('Registration for this feis is not open.')
  if (windowBlock === 'not_yet_open') return fail('Registration for this feis has not opened yet.')
  if (windowBlock === 'closed') return fail('Registration for this feis has closed.')

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

  // An add-on only adds: a dance already in one of the family's paid orders is never bought twice
  const entered = new Set(
    (request.paidOrders ?? []).flatMap((order) =>
      order.entries.map((entry) => `${entry.dancer_id}:${entry.competition_id}`)
    )
  )
  for (const entry of request.entries) {
    if (entered.has(`${entry.dancerId}:${entry.competitionId}`)) {
      const dancer = dancers.get(entry.dancerId)!
      const competition = competitions.get(entry.competitionId)!
      return fail(
        `${dancer.first_name} is already entered in ${competition.display_name}. Reload this page to see your entries.`
      )
    }
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
