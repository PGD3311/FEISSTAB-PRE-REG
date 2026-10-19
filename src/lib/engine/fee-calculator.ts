import type {
  CountedOrder,
  FeeSchedule,
  FeeEntry,
  FeeLineItem,
  FeeBreakdown,
  FeeCategoryType,
  LateFeeTier,
  PriorPaidFees
} from '@/lib/types/feis-listing'

const FEE_CATEGORY_MAP: Record<FeeCategoryType, keyof FeeSchedule> = {
  solo: 'solo_fee_cents',
  prelim_champ: 'prelim_champ_fee_cents',
  open_champ: 'open_champ_fee_cents'
}

/** What one entry into this competition costs before late fees and the family cap. */
export function competitionFeeCents(
  competition: { fee_category: FeeCategoryType; fee_cents: number | null },
  schedule: FeeSchedule
): number {
  return competition.fee_cents ?? (schedule[FEE_CATEGORY_MAP[competition.fee_category]] as number)
}

/** The latest late-fee tier that has started at `at`, or null if registration is not late. */
export function getActiveLateTier(tiers: LateFeeTier[], at: Date): LateFeeTier | null {
  let active: LateFeeTier | null = null
  for (const tier of tiers) {
    const starts = new Date(tier.starts_at).getTime()
    if (starts > at.getTime()) continue
    if (!active || starts > new Date(active.starts_at).getTime()) active = tier
  }
  return active
}

/**
 * Fee totals for one family's registration, following the usual feis rules:
 * - Each entry costs its competition's own price if it has one, else its category fee.
 * - The family cap limits competition entry fees only. The event fee, late fees,
 *   day-of surcharges and competitions excluded from the cap are paid on top.
 * - The active late tier charges its fee once per dancer, up to the tier's family max.
 * - `prior` is what the family already paid for this feis in earlier orders: the event fee
 *   isn't charged again, dancers already charged a late fee aren't charged again, and the
 *   family max and the late tier's family max count what was already paid.
 */
export function calculateFees(
  schedule: FeeSchedule,
  entries: FeeEntry[],
  at: Date = new Date(),
  prior: PriorPaidFees | null = null
): FeeBreakdown {
  const active_late_tier = getActiveLateTier(schedule.late_fee_tiers, at)
  const lateCharged = new Set<string>(prior?.late_fee_dancer_ids ?? [])
  const dayOfCharged = new Set<string>()
  const latePaidBefore = prior?.late_fees_paid_cents ?? 0
  let late_fees_cents = 0

  const line_items: FeeLineItem[] = entries.map((entry) => {
    const base_fee_cents = competitionFeeCents(
      { fee_category: entry.fee_category, fee_cents: entry.fee_cents_override ?? null },
      schedule
    )

    let late_fee_cents = 0
    if (active_late_tier && !lateCharged.has(entry.dancer_id)) {
      lateCharged.add(entry.dancer_id)
      const remaining =
        active_late_tier.family_max_cents === null
          ? active_late_tier.fee_cents
          : Math.max(0, active_late_tier.family_max_cents - latePaidBefore - late_fees_cents)
      late_fee_cents = Math.min(active_late_tier.fee_cents, remaining)
      late_fees_cents += late_fee_cents
    }

    let day_of_surcharge_cents = 0
    if (entry.is_day_of && !dayOfCharged.has(entry.dancer_id)) {
      day_of_surcharge_cents = schedule.day_of_surcharge_cents
      dayOfCharged.add(entry.dancer_id)
    }

    return {
      dancer_id: entry.dancer_id,
      base_fee_cents,
      late_fee_cents,
      day_of_surcharge_cents,
      line_total_cents: base_fee_cents + late_fee_cents + day_of_surcharge_cents,
      counts_toward_family_cap: !entry.exclude_from_family_cap
    }
  })

  const event_fee_cents = prior?.event_fee_paid ? 0 : schedule.event_fee_cents

  const subtotal_per_dancer: Record<string, number> = {}
  for (const item of line_items) {
    subtotal_per_dancer[item.dancer_id] =
      (subtotal_per_dancer[item.dancer_id] ?? 0) + item.line_total_cents
  }

  const line_items_total = line_items.reduce((sum, item) => sum + item.line_total_cents, 0)
  const subtotal_before_cap_cents = event_fee_cents + line_items_total

  const cappable_cents = line_items
    .filter((item) => item.counts_toward_family_cap)
    .reduce((sum, item) => sum + item.base_fee_cents, 0)

  // What's left under the family max once earlier orders are counted
  const family_cap_savings_cents =
    schedule.family_cap_cents === null
      ? 0
      : Math.max(
          0,
          cappable_cents -
            Math.max(0, schedule.family_cap_cents - (prior?.cappable_paid_cents ?? 0))
        )

  return {
    line_items,
    event_fee_cents,
    subtotal_per_dancer,
    late_fees_cents,
    active_late_tier,
    subtotal_before_cap_cents,
    family_cap_applied: family_cap_savings_cents > 0,
    family_cap_savings_cents,
    grand_total_cents: subtotal_before_cap_cents - family_cap_savings_cents
  }
}

/** Plain code-unit order, the order Postgres gives uuids. Never localeCompare (spec §4). */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * What a family has already paid for one feis, from its paid orders. Each entry says itself whether
 * it counted toward the family max when it was bought (spec §4), so a competition's flag changing
 * later doesn't change what an earlier order covered.
 */
export function summarisePaidOrders(orders: CountedOrder[]): PriorPaidFees | null {
  if (orders.length === 0) return null
  const entries = orders.flatMap((order) => order.entries)
  return {
    event_fee_paid: orders.some((order) => order.event_fee_cents > 0),
    cappable_paid_cents: entries
      .filter((entry) => entry.counts_toward_family_cap)
      .reduce((sum, entry) => sum + entry.base_fee_cents, 0),
    late_fee_dancer_ids: [
      ...new Set(
        entries.filter((entry) => entry.late_fee_cents > 0).map((entry) => entry.dancer_id)
      )
    ].sort(compareIds),
    late_fees_paid_cents: entries.reduce((sum, entry) => sum + entry.late_fee_cents, 0)
  }
}
