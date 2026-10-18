import { canStartOrder, type OrderStartInput } from '@/lib/engine/order-validation'
import { formatCents } from '@/lib/format'
import { openMessageAFor, type PaymentReview } from '@/lib/payment-review-messages'
import type {
  ChampionshipStatus,
  DancerDanceLevel,
  EligibleCompetition,
  FeeBreakdown,
  FeisListing,
  Level,
  RegistrationStatus
} from '@/lib/types/feis-listing'

/** One line describing a dancer's level, e.g. "Novice", "Mixed levels", "Prelim champion". */
export function dancerLevelSummary(
  danceLevels: Pick<DancerDanceLevel, 'level_key'>[],
  levels: Level[],
  championshipStatus: ChampionshipStatus
): string {
  if (championshipStatus === 'prelim') return 'Prelim champion'
  if (championshipStatus === 'open') return 'Open champion'

  const keys = [...new Set(danceLevels.map((dl) => dl.level_key))]
  if (keys.length === 0) return 'No levels set'
  if (keys.length > 1) return 'Mixed levels'
  return levels.find((l) => l.key === keys[0])?.label ?? keys[0]
}

export interface CompetitionGroup {
  label: string
  items: EligibleCompetition[]
}

const TYPE_LABELS: Record<string, string> = {
  championship: 'Championships',
  special: 'Specials',
  custom: 'Other'
}

/**
 * Groups competitions the way a syllabus prints them: solo dances by level and age group
 * ("Novice, Under 12"), then championships, specials and other competitions.
 * Groups keep the order their first competition appears in.
 */
export function groupForEntryForm(items: EligibleCompetition[]): CompetitionGroup[] {
  const groups = new Map<string, CompetitionGroup>()
  const typeOrder = ['solo', 'championship', 'special', 'custom']
  const sorted = [...items].sort(
    (a, b) =>
      typeOrder.indexOf(a.competition.competition_type) -
      typeOrder.indexOf(b.competition.competition_type)
  )

  for (const item of sorted) {
    const comp = item.competition
    const label =
      comp.competition_type === 'solo'
        ? [comp.level_label, comp.age_group_label].filter(Boolean).join(', ') || 'Solo dances'
        : (TYPE_LABELS[comp.competition_type] ?? 'Other')
    const group = groups.get(label) ?? { label, items: [] }
    group.items.push(item)
    groups.set(label, group)
  }

  return [...groups.values()]
}

/** Entry fees per dancer before late fees, the event fee and the family max. */
export function entryFeesPerDancer(breakdown: FeeBreakdown): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const item of breakdown.line_items) {
    totals[item.dancer_id] = (totals[item.dancer_id] ?? 0) + item.base_fee_cents
  }
  return totals
}

/** When entries finally close (the late deadline if there is one), and whether that has passed. */
export function entryDeadline(
  listing: Pick<FeisListing, 'reg_closes_at' | 'late_reg_closes_at'>,
  now: Date = new Date()
): { closesAt: string | null; closed: boolean } {
  const closesAt = listing.late_reg_closes_at ?? listing.reg_closes_at
  if (!closesAt) return { closesAt: null, closed: false }
  return { closesAt, closed: new Date(closesAt) <= now }
}

/** e.g. "Thu 26 Feb, 11:59 pm" in the feis's own time zone. */
export function formatDeadline(isoString: string, timeZone: string): string {
  const date = new Date(isoString)
  const day = date.toLocaleDateString('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  })
  const time = date
    .toLocaleTimeString('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit'
    })
    .toLowerCase()
  return `${day}, ${time}`
}

/**
 * Whether an order was an add-on: its price counted the family's earlier paid orders (spec §14). Orders made
 * before add-ons, and every family's first order, have no counted orders.
 */
export function isAddOnOrder(order: {
  purchase_snapshot: { pricing?: { prior?: unknown } } | null
}): boolean {
  return order.purchase_snapshot?.pricing?.prior != null
}

/**
 * What a family is told when Submit's price isn't the total the page showed (a late fee tier
 * started, the organiser changed a fee, or their paid orders changed while it was open). The held
 * order keeps Submit's price, and the button now reads "Confirm entries" at $0, otherwise "Pay".
 */
export function repricedNotice(newTotalCents: number): string {
  const button = newTotalCents === 0 ? 'Confirm entries' : 'Pay'
  return (
    `Your total has been updated to ${formatCents(newTotalCents)}. ` +
    `Check the receipt, then press ${button} to continue.`
  )
}

/**
 * The dances already paid for, per dancer, across the family's paid orders in the order given.
 * `lookup` finds a competition by id; an id it doesn't know is left out. It should cover every
 * competition a paid entry is for, enabled or not, since a dance stays entered after the organiser
 * turns it off.
 */
export function enteredByDancer<T>(
  paidOrders: { registration_entries: { dancer_id: string; feis_competition_id: string }[] }[],
  lookup: Map<string, T>
): Record<string, T[]> {
  const entered: Record<string, T[]> = {}
  for (const order of paidOrders) {
    for (const entry of order.registration_entries) {
      const competition = lookup.get(entry.feis_competition_id)
      if (competition === undefined) continue
      entered[entry.dancer_id] = [...(entered[entry.dancer_id] ?? []), competition]
    }
  }
  return entered
}

/** What My entries' Add dances choice reads from each of the family's orders */
export interface AddDancesOrder {
  id: string
  feis_listing_id: string
  status: RegistrationStatus
  hold_expires_at: string | null
  feis_listings: OrderStartInput['listing']
}

/**
 * The orders that offer Add dances on My entries: the newest paid order of each feis that can take
 * a new order now (`canStartOrder`, spec §14). `registrations` are the family's orders, newest
 * first, so the first paid order found for a feis is its newest. A feis isn't offered while the
 * family holds an unpaid order whose hold hasn't run out, or has an open message-A case. If the
 * payment cases couldn't be read (`reviewsFailed`), whether message A is open can't be judged, so
 * nothing is offered.
 */
export function addDancesOrderIds(
  registrations: AddDancesOrder[],
  reviews: PaymentReview[],
  reviewsFailed: boolean,
  now: Date
): Set<string> {
  const offered = new Set<string>()
  if (reviewsFailed) return offered
  const feisIds = new Set(registrations.map((reg) => reg.feis_listing_id))
  for (const feisId of feisIds) {
    const forFeis = registrations.filter((reg) => reg.feis_listing_id === feisId)
    const orderIds = forFeis.map((reg) => reg.id)
    const newestPaid = forFeis.find((reg) => reg.status === 'paid')
    if (!newestPaid) continue
    const hasUnpaidOrder = forFeis.some(
      (reg) =>
        (reg.status === 'draft' || reg.status === 'pending_payment') &&
        (reg.hold_expires_at === null || new Date(reg.hold_expires_at) > now)
    )
    const canAdd = canStartOrder({
      listing: newestPaid.feis_listings,
      now,
      hasUnpaidOrder,
      hasOpenMessageA: openMessageAFor(reviews, orderIds) !== null
    })
    if (canAdd) offered.add(newestPaid.id)
  }
  return offered
}
