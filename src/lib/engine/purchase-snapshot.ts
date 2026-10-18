import { calculateAgeOnDate } from '@/lib/engine/eligibility'
import { calculateFees, compareIds, summarisePaidOrders } from '@/lib/engine/fee-calculator'
import {
  toDancerProfile,
  type OrderDancer,
  type OrderListing,
  type RequestedEntry
} from '@/lib/engine/order-validation'
import type {
  ChampionshipStatus,
  CountedOrders,
  FeeBreakdown,
  FeeCategoryType,
  FeeEntry,
  FeeSchedule,
  FeisCompetition,
  Level,
  PaidOrder
} from '@/lib/types/feis-listing'

/** pricing-2026-10-17: prices count the family's earlier paid orders for the feis (spec §4) */
export const PRICING_VERSION = 'pricing-2026-10-17'
export const ELIGIBILITY_VERSION = 'eligibility-2026-10-16'
/**
 * The consent checkbox wording in family-receipt.tsx: the person entering the dancers is their parent or guardian,
 * or is entering them with that parent or guardian's permission, and accepts the RunFeis terms and privacy policy
 * (and the feis's terms); entry fees aren't refundable. Must change in the same commit as the wording.
 */
export const CONSENT_VERSION = 'consent-2026-10-16b'
/** The RunFeis /terms and /privacy pages; must change in the same commit as either page */
export const PLATFORM_TERMS_VERSION = 'runfeis-terms-2026-10-16/privacy-2026-10-16'

export interface SnapshotDancer {
  id: string
  first_name: string
  last_name: string
  school_name: string | null
  /** The shared schools list's row for school_name (migration 018), or null */
  school_id: string | null
  /** 'guest': someone else's child the account holder entered (migration 018) */
  relationship: 'household' | 'guest'
  tcrg_name: string | null
  date_of_birth: string
  gender: string
  championship_status: ChampionshipStatus
  dance_levels: Record<string, string>
  competition_age: number
}

/** A competition as eligibility and pricing read it at purchase, age bounds and labels included */
export interface SnapshotCompetition {
  id: string
  display_code: string | null
  display_name: string
  age_group_key: string | null
  age_group_label: string | null
  age_min_jan1: number | null
  age_max_jan1: number | null
  level_key: string | null
  level_label: string | null
  dance_key: string | null
  dance_label: string | null
  competition_type: string
  championship_key: string | null
  grades_only: boolean
  fee_category: FeeCategoryType
  fee_cents: number | null
  exclude_from_family_cap: boolean
}

export interface SnapshotEntry {
  dancer_id: string
  competition_id: string
  fee_category: FeeCategoryType
  base_fee_cents: number
  late_fee_cents: number
  day_of_surcharge_cents: number
}

/** What an order was validated and priced on, frozen at Submit (spec §3). */
export interface PurchaseSnapshot {
  version: 1
  dancers: SnapshotDancer[]
  competitions: SnapshotCompetition[]
  entries: SnapshotEntry[]
  pricing: {
    fee_schedule: FeeSchedule
    breakdown: FeeBreakdown
    priced_at: string
    /** The paid orders this price counted, and what they covered; null on a family's first order */
    prior: CountedOrders | null
  }
  rules: {
    age_cutoff_date: string
    levels: Level[]
    consent_version: string
    platform_terms_version: string
    /** The feis's own terms link the family agreed to, if it has one */
    feis_terms_url: string | null
    pricing_version: string
    eligibility_version: string
  }
}

export interface PriceOrderInput {
  now: Date
  ageCutoffDate: Date
  levels: Level[]
  feisTermsUrl: OrderListing['terms_url']
  dancers: OrderDancer[]
  competitions: FeisCompetition[]
  entries: RequestedEntry[]
  feeSchedule: FeeSchedule
  /** The family's paid orders for this feis, from paidOrdersFrom(); none for a first order */
  paidOrders?: PaidOrder[]
}

export interface PricedOrder {
  breakdown: FeeBreakdown
  snapshot: PurchaseSnapshot
}

export interface CreateOrderPayload {
  total_cents: number
  application_fee_cents: number
  event_fee_cents: number
  is_late: boolean
  consent_ip: string | null
  consent_version: string
  platform_terms_version: string
  entries: {
    dancer_id: string
    feis_competition_id: string
    fee_category: FeeCategoryType
    base_fee_cents: number
    late_fee_cents: number
    day_of_surcharge_cents: number
  }[]
  purchase_snapshot: PurchaseSnapshot
}

/** A paid order as Submit and the entry page read it: the row, its entries and its purchase snapshot */
export interface PaidOrderRow {
  id: string
  confirmation_number: string | null
  event_fee_cents: number
  purchase_snapshot: Pick<PurchaseSnapshot, 'competitions'> | null
  registration_entries: {
    dancer_id: string
    feis_competition_id: string
    base_fee_cents: number
    late_fee_cents: number
  }[]
}

/**
 * The family's paid orders as later orders count them. Whether an entry counted toward the family max
 * comes from its own order's purchase snapshot; an older order without one (made before snapshots)
 * uses the competition's current setting. create_order reads the rows by the same rule.
 */
export function paidOrdersFrom(
  rows: PaidOrderRow[],
  competitions: Pick<FeisCompetition, 'id' | 'exclude_from_family_cap'>[]
): PaidOrder[] {
  const current = new Map(competitions.map((c) => [c.id, c.exclude_from_family_cap]))
  return rows.map((row) => {
    const frozen = new Map(
      (row.purchase_snapshot?.competitions ?? []).map((c) => [c.id, c.exclude_from_family_cap])
    )
    return {
      id: row.id,
      confirmation_number: row.confirmation_number,
      event_fee_cents: row.event_fee_cents,
      entries: row.registration_entries.map((entry) => ({
        dancer_id: entry.dancer_id,
        competition_id: entry.feis_competition_id,
        base_fee_cents: entry.base_fee_cents,
        late_fee_cents: entry.late_fee_cents,
        counts_toward_family_cap: !(
          frozen.get(entry.feis_competition_id) ??
          current.get(entry.feis_competition_id) ??
          false
        )
      }))
    }
  })
}

/**
 * The counted-orders record exactly as create_order rebuilds it in SQL (spec §4): orders sorted by
 * id, each order's entries by dancer then competition, ids in lower case, every key present, and
 * null for a family with no paid orders. The two are compared as jsonb, so any difference refuses.
 */
export function countedOrdersRecord(orders: PaidOrder[]): CountedOrders | null {
  if (orders.length === 0) return null
  const sorted: PaidOrder[] = orders
    .map((order) => ({
      id: order.id.toLowerCase(),
      confirmation_number: order.confirmation_number ?? null,
      event_fee_cents: order.event_fee_cents,
      entries: order.entries
        .map((entry) => ({
          dancer_id: entry.dancer_id.toLowerCase(),
          competition_id: entry.competition_id.toLowerCase(),
          base_fee_cents: entry.base_fee_cents,
          late_fee_cents: entry.late_fee_cents,
          counts_toward_family_cap: entry.counts_toward_family_cap
        }))
        .sort(
          (a, b) =>
            compareIds(a.dancer_id, b.dancer_id) || compareIds(a.competition_id, b.competition_id)
        )
    }))
    .sort((a, b) => compareIds(a.id, b.id))
  return { orders: sorted, ...summarisePaidOrders(sorted)! }
}

/** yyyy-mm-dd of a date made by parseLocalDate */
function localIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function feeEntriesFor(
  entries: RequestedEntry[],
  competitions: Map<string, FeisCompetition>
): FeeEntry[] {
  return entries.map((entry) => {
    const competition = competitions.get(entry.competitionId)!
    return {
      dancer_id: entry.dancerId,
      fee_category: competition.fee_category,
      fee_cents_override: competition.fee_cents,
      exclude_from_family_cap: competition.exclude_from_family_cap,
      is_day_of: false
    }
  })
}

/**
 * Pairs each requested entry with the pricing line made for it, by position. calculateFees keeps
 * entry order; this refuses a result that doesn't, since create_order can't see a mispairing (the
 * payload and the snapshot come from the same pairing, and swapped fees keep the same total).
 */
export function pairLineItems<Line extends { dancer_id: string; competition_id?: string }>(
  entries: RequestedEntry[],
  lines: Line[]
): { entry: RequestedEntry; line: Line }[] {
  if (lines.length !== entries.length) {
    throw new Error(`Pricing returned ${lines.length} lines for ${entries.length} entries`)
  }
  return entries.map((entry, i) => {
    const line = lines[i]
    if (
      line.dancer_id !== entry.dancerId ||
      (line.competition_id !== undefined && line.competition_id !== entry.competitionId)
    ) {
      throw new Error(
        `Pricing line ${i + 1} doesn't match entry ${i + 1} ` +
          `(dancer ${entry.dancerId}, competition ${entry.competitionId})`
      )
    }
    return { entry, line }
  })
}

/** Prices a validated order and freezes everything the price and eligibility were based on. */
export function priceOrder(input: PriceOrderInput): PricedOrder {
  const competitions = new Map(input.competitions.map((c) => [c.id, c]))
  const dancers = new Map(input.dancers.map((d) => [d.id, d]))
  const feeEntries = feeEntriesFor(input.entries, competitions)
  // An add-on is priced on top of what the family's paid orders already covered
  const prior = countedOrdersRecord(input.paidOrders ?? [])
  const breakdown = calculateFees(input.feeSchedule, feeEntries, input.now, prior)

  const dancerIds = [...new Set(input.entries.map((e) => e.dancerId))]
  const competitionIds = [...new Set(input.entries.map((e) => e.competitionId))]

  const snapshot: PurchaseSnapshot = {
    version: 1,
    dancers: dancerIds.map((id) => {
      const dancer = dancers.get(id)!
      const profile = toDancerProfile(dancer)
      return {
        id: dancer.id,
        first_name: dancer.first_name,
        last_name: dancer.last_name,
        school_name: dancer.school_name,
        // Optional on Dancer; without them, a household dancer with no school link
        school_id: dancer.school_id ?? null,
        relationship: dancer.relationship ?? 'household',
        tcrg_name: dancer.tcrg_name,
        date_of_birth: dancer.date_of_birth,
        gender: dancer.gender,
        championship_status: dancer.championship_status,
        dance_levels: profile.danceLevels,
        competition_age: calculateAgeOnDate(profile.dob, input.ageCutoffDate)
      }
    }),
    competitions: competitionIds.map((id) => {
      const c = competitions.get(id)!
      return {
        id: c.id,
        display_code: c.display_code,
        display_name: c.display_name,
        age_group_key: c.age_group_key,
        age_group_label: c.age_group_label,
        age_min_jan1: c.age_min_jan1,
        age_max_jan1: c.age_max_jan1,
        level_key: c.level_key,
        level_label: c.level_label,
        dance_key: c.dance_key,
        dance_label: c.dance_label,
        competition_type: c.competition_type,
        championship_key: c.championship_key,
        grades_only: c.grades_only,
        fee_category: c.fee_category,
        fee_cents: c.fee_cents,
        exclude_from_family_cap: c.exclude_from_family_cap
      }
    }),
    entries: pairLineItems(input.entries, breakdown.line_items).map(({ entry, line }, i) => ({
      dancer_id: entry.dancerId,
      competition_id: entry.competitionId,
      fee_category: feeEntries[i].fee_category,
      base_fee_cents: line.base_fee_cents,
      late_fee_cents: line.late_fee_cents,
      day_of_surcharge_cents: line.day_of_surcharge_cents
    })),
    pricing: {
      fee_schedule: input.feeSchedule,
      breakdown,
      priced_at: input.now.toISOString(),
      prior
    },
    rules: {
      age_cutoff_date: localIsoDate(input.ageCutoffDate),
      levels: input.levels,
      consent_version: CONSENT_VERSION,
      platform_terms_version: PLATFORM_TERMS_VERSION,
      feis_terms_url: input.feisTermsUrl,
      pricing_version: PRICING_VERSION,
      eligibility_version: ELIGIBILITY_VERSION
    }
  }

  return { breakdown, snapshot }
}

/** What create_order (migration 013) receives. The database checks it against the snapshot. */
export function buildCreateOrderPayload(
  order: PricedOrder,
  opts: { applicationFeePercent: number; consentIp: string | null }
): CreateOrderPayload {
  const percent = opts.applicationFeePercent
  if (!Number.isFinite(percent) || percent < 0 || percent >= 100) {
    throw new Error(`The application fee percent must be at least 0 and below 100, not ${percent}`)
  }
  const total = order.breakdown.grand_total_cents
  return {
    total_cents: total,
    // Whole basis points: a float percent mis-rounds half cents (2.9% of 500 is 15, not 14)
    application_fee_cents: Math.round((total * Math.round(percent * 100)) / 10000),
    event_fee_cents: order.breakdown.event_fee_cents,
    is_late: order.breakdown.active_late_tier !== null,
    consent_ip: opts.consentIp,
    consent_version: CONSENT_VERSION,
    platform_terms_version: PLATFORM_TERMS_VERSION,
    entries: order.snapshot.entries.map((e) => ({
      dancer_id: e.dancer_id,
      feis_competition_id: e.competition_id,
      fee_category: e.fee_category,
      base_fee_cents: e.base_fee_cents,
      late_fee_cents: e.late_fee_cents,
      day_of_surcharge_cents: e.day_of_surcharge_cents
    })),
    purchase_snapshot: order.snapshot
  }
}
