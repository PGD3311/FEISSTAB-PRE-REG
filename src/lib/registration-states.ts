import type { RegistrationStatus } from '@/lib/types/feis-listing'

// Mirrors registration_transition_allowed() in supabase/migrations/012_order_integrity.sql.
// tests/db/order-integrity.test.ts checks that the two agree.
export const REGISTRATION_TRANSITIONS: Record<RegistrationStatus, RegistrationStatus[]> = {
  // draft → paid: the payment came through the order's own checkout claim before Pay attached the session
  draft: ['pending_payment', 'cancelled', 'expired', 'paid'],
  pending_payment: ['paid', 'expired', 'cancelled'],
  paid: [],
  // expired → paid: a late payment on the order's own claim, confirmed by the database
  expired: ['paid'],
  cancelled: [],
}

export function canTransitionRegistration(
  from: RegistrationStatus,
  to: RegistrationStatus
): boolean {
  return REGISTRATION_TRANSITIONS[from]?.includes(to) ?? false
}

export function getNextRegistrationStates(
  current: RegistrationStatus
): RegistrationStatus[] {
  return REGISTRATION_TRANSITIONS[current] ?? []
}
