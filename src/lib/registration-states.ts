import type { RegistrationStatus } from '@/lib/types/feis-listing'

const VALID_TRANSITIONS: Record<RegistrationStatus, RegistrationStatus[]> = {
  draft: ['pending_payment', 'cancelled', 'expired'],
  pending_payment: ['paid', 'expired', 'cancelled'],
  paid: [],
  expired: [],
  cancelled: [],
}

export function canTransitionRegistration(
  from: RegistrationStatus,
  to: RegistrationStatus
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

export function getNextRegistrationStates(
  current: RegistrationStatus
): RegistrationStatus[] {
  return VALID_TRANSITIONS[current] ?? []
}
