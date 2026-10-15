import type {
  FeeSchedule,
  FeeEntry,
  FeeLineItem,
  FeeBreakdown,
  FeeCategoryType,
  LateFeeTier
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
 */
export function calculateFees(
  schedule: FeeSchedule,
  entries: FeeEntry[],
  at: Date = new Date()
): FeeBreakdown {
  const active_late_tier = getActiveLateTier(schedule.late_fee_tiers, at)
  const lateCharged = new Set<string>()
  const dayOfCharged = new Set<string>()
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
          : Math.max(0, active_late_tier.family_max_cents - late_fees_cents)
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

  const event_fee_cents = schedule.event_fee_cents

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

  const family_cap_savings_cents =
    schedule.family_cap_cents === null
      ? 0
      : Math.max(0, cappable_cents - schedule.family_cap_cents)

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
