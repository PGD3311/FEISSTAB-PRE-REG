import type {
  FeeSchedule,
  FeeEntry,
  FeeLineItem,
  FeeBreakdown,
  FeeCategoryType
} from '@/lib/types/feis-listing'

const FEE_CATEGORY_MAP: Record<FeeCategoryType, keyof FeeSchedule> = {
  solo: 'solo_fee_cents',
  prelim_champ: 'prelim_champ_fee_cents',
  open_champ: 'open_champ_fee_cents'
}

export function calculateFees(
  schedule: FeeSchedule,
  entries: FeeEntry[]
): FeeBreakdown {
  const lateCharged = new Set<string>()
  const dayOfCharged = new Set<string>()

  const line_items: FeeLineItem[] = entries.map((entry) => {
    const base_fee_cents = schedule[FEE_CATEGORY_MAP[entry.fee_category]] as number

    let late_fee_cents = 0
    if (entry.is_late && !lateCharged.has(entry.dancer_id)) {
      late_fee_cents = schedule.late_fee_cents
      lateCharged.add(entry.dancer_id)
    }

    let day_of_surcharge_cents = 0
    if (entry.is_day_of && !dayOfCharged.has(entry.dancer_id)) {
      day_of_surcharge_cents = schedule.day_of_surcharge_cents
      dayOfCharged.add(entry.dancer_id)
    }

    const line_total_cents = base_fee_cents + late_fee_cents + day_of_surcharge_cents

    return {
      dancer_id: entry.dancer_id,
      base_fee_cents,
      late_fee_cents,
      day_of_surcharge_cents,
      line_total_cents
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

  const family_cap_applied =
    schedule.family_cap_cents !== null &&
    subtotal_before_cap_cents > schedule.family_cap_cents

  const grand_total_cents = family_cap_applied
    ? schedule.family_cap_cents!
    : subtotal_before_cap_cents

  return {
    line_items,
    event_fee_cents,
    subtotal_per_dancer,
    subtotal_before_cap_cents,
    family_cap_applied,
    grand_total_cents
  }
}
