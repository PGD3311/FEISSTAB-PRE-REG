import type { PurchaseSnapshot } from '@/lib/engine/purchase-snapshot'

export const CHECKOUT_WINDOW_MINUTES = 60
export const HOLD_AFTER_CHECKOUT_MINUTES = 15

export interface CheckoutLineItem {
  name: string
  amount_cents: number
}

/** The complete Stripe Checkout request for one claim, frozen when the claim is made (spec §6). */
export interface CheckoutConfig {
  version: 1
  account: string
  currency: 'usd'
  total_cents: number
  application_fee_cents: number
  line_items: CheckoutLineItem[]
  success_url: string
  cancel_url: string
  /** Unix seconds */
  expires_at: number
  payment_method_types: ['card']
  client_reference_id: string
  metadata: { registration_id: string; claim_id: string }
  idempotency_key: string
}

export interface CheckoutConfigInput {
  registrationId: string
  feisListingId: string
  claimId: string
  account: string
  totalCents: number
  applicationFeeCents: number
  eventFeeCents: number
  snapshot: PurchaseSnapshot
  baseUrl: string
  now: Date
}

export function checkoutLineItems(
  snapshot: PurchaseSnapshot,
  eventFeeCents: number,
  totalCents: number
): CheckoutLineItem[] {
  const dancers = new Map(snapshot.dancers.map((d) => [d.id, d]))
  const competitions = new Map(snapshot.competitions.map((c) => [c.id, c]))
  const items: CheckoutLineItem[] = []
  if (eventFeeCents > 0) items.push({ name: 'Event fee (per family)', amount_cents: eventFeeCents })
  for (const entry of snapshot.entries) {
    const amount = entry.base_fee_cents + entry.late_fee_cents + entry.day_of_surcharge_cents
    if (amount === 0) continue
    const dancer = dancers.get(entry.dancer_id)
    const competition = competitions.get(entry.competition_id)
    const label = [competition?.display_code, competition?.display_name].filter(Boolean).join(' ')
    items.push({
      name: `${dancer?.first_name ?? 'Dancer'}: ${label || 'Competition entry'}`,
      amount_cents: amount
    })
  }
  const sum = items.reduce((total, item) => total + item.amount_cents, 0)
  // Stripe has no negative line items, so a family-max discount becomes one line at the capped total
  if (sum !== totalCents) {
    return [{ name: 'Feis entries (family maximum applied)', amount_cents: totalCents }]
  }
  return items
}

export function buildCheckoutConfig(input: CheckoutConfigInput): CheckoutConfig {
  return {
    version: 1,
    account: input.account,
    currency: 'usd',
    total_cents: input.totalCents,
    application_fee_cents: input.applicationFeeCents,
    line_items: checkoutLineItems(input.snapshot, input.eventFeeCents, input.totalCents),
    success_url: `${input.baseUrl}/feiseanna/${input.feisListingId}/register/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.baseUrl}/feiseanna/${input.feisListingId}/register`,
    expires_at: Math.floor(input.now.getTime() / 1000) + CHECKOUT_WINDOW_MINUTES * 60,
    payment_method_types: ['card'],
    client_reference_id: input.registrationId,
    metadata: { registration_id: input.registrationId, claim_id: input.claimId },
    idempotency_key: `checkout:${input.registrationId}:${input.claimId}`
  }
}
