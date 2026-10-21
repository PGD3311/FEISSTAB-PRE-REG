import type {
  FeeCategoryType,
  FeeSchedule,
  ListingStatus,
  ListingTransitionContext,
  PublishValidation,
} from '@/lib/types/feis-listing'

// ─── Transition maps (mirror guard_feis_listings and the admin functions in 021) ───

/** Who moves the feis: its organiser, or a RunFeis admin (approve_listing, send_back_listing) */
export type ListingActor = 'owner' | 'admin'

const OWNER_TRANSITIONS: Record<ListingStatus, ListingStatus[]> = {
  draft: ['pending_review'], // submit for approval
  pending_review: ['draft'], // withdraw
  open: ['closed'],
  closed: ['open', 'launched'], // reopening needs an earlier approval: see the block reasons
  launched: [] // Terminal state
}

const ADMIN_TRANSITIONS: Record<ListingStatus, ListingStatus[]> = {
  draft: [],
  pending_review: ['open', 'draft'], // approve, send back
  open: [],
  closed: [],
  launched: []
}

const TRANSITIONS: Record<ListingActor, Record<ListingStatus, ListingStatus[]>> = {
  owner: OWNER_TRANSITIONS,
  admin: ADMIN_TRANSITIONS
}

// ─── Public API ───

/**
 * Check whether a status transition is allowed for the actor (the organiser by default).
 * A draft never opens directly: it opens only when an admin approves it.
 */
export function canTransitionListing(
  from: ListingStatus,
  to: ListingStatus,
  actor: ListingActor = 'owner'
): boolean {
  return TRANSITIONS[actor][from]?.includes(to) ?? false
}

/**
 * Return the list of valid next states for a given status and actor (the organiser by default).
 */
export function getNextListingStates(
  current: ListingStatus,
  actor: ListingActor = 'owner'
): ListingStatus[] {
  return TRANSITIONS[actor][current] ?? []
}

/** True when a text field has something other than spaces in it */
function filled(value: string | null): boolean {
  return value !== null && value.trim() !== ''
}

/**
 * The fee rules: a fee of $0 is refused for a kind of competition the feis offers. Part of the
 * submit check, and enforced again when an organiser saves fees on a feis past draft (the
 * database mirrors it: guard_fee_schedule_amounts in 022).
 */
export function getFeeBlockReasons(
  feeSchedule: Pick<FeeSchedule, 'solo_fee_cents' | 'prelim_champ_fee_cents' | 'open_champ_fee_cents'>,
  competitions: { fee_category: FeeCategoryType }[]
): string[] {
  const blocks: string[] = []
  const offers = (category: FeeCategoryType) => competitions.some((c) => c.fee_category === category)

  if (offers('solo') && feeSchedule.solo_fee_cents === 0) {
    blocks.push('Solo fee must be greater than $0 when solo competitions exist')
  }
  if (offers('prelim_champ') && feeSchedule.prelim_champ_fee_cents === 0) {
    blocks.push('Championship fee must be greater than $0 when championship competitions exist')
  }
  if (offers('open_champ') && feeSchedule.open_champ_fee_cents === 0) {
    blocks.push('Championship fee must be greater than $0 when championship competitions exist')
  }
  return blocks
}

/**
 * Return publish-gate validation: hard blocks and soft warnings.
 * Enforced on draft → pending_review (submit for approval), closed → open (reopen) and
 * closed → launched.
 */
export function getListingTransitionBlockReasons(
  from: ListingStatus,
  to: ListingStatus,
  context: ListingTransitionContext
): PublishValidation {
  // closed → launched validation
  if (from === 'closed' && to === 'launched') {
    return getLaunchBlockReasons(context)
  }

  // closed → open: only a feis RunFeis approved before can take entries again
  if (from === 'closed' && to === 'open') {
    return {
      blocks: context.listing.approved_at ? [] : ['RunFeis has not approved this feis'],
      warnings: []
    }
  }

  if (from !== 'draft' || to !== 'pending_review') {
    return { blocks: [], warnings: [] }
  }

  const { listing, feeSchedule, enabledCompetitions } = context
  const blocks: string[] = []
  const warnings: string[] = []

  // ─── Hard blocks: required fields ───

  if (!listing.name) {
    blocks.push('Feis name is required')
  }

  if (!listing.feis_date) {
    blocks.push('Feis date is required')
  } else {
    const today = new Date().toISOString().split('T')[0]
    if (listing.feis_date < today) {
      blocks.push('Feis date must be in the future')
    }
  }

  if (!listing.venue_name) {
    blocks.push('Venue name is required')
  }

  if (!listing.contact_email) {
    blocks.push('Contact email is required')
  }

  if (!listing.timezone) {
    blocks.push('Timezone is required')
  }

  if (!listing.privacy_policy_url) {
    blocks.push('Privacy policy URL is required')
  }

  // ─── Hard blocks: approval details ───

  if (!filled(listing.sanction_region)) {
    blocks.push('Sanction region is required')
  }

  if (!filled(listing.sanction_reference)) {
    blocks.push('Sanction reference is required')
  }

  if (!context.hasOrganiserProfile) {
    blocks.push('Your organiser details are required')
  }

  // ─── Hard blocks: competitions ───

  if (enabledCompetitions.length === 0) {
    blocks.push('At least one competition must be enabled')
  }

  // ─── Hard blocks: fee schedule ───

  if (!feeSchedule) {
    blocks.push('Fee schedule is required')
  } else {
    blocks.push(...getFeeBlockReasons(feeSchedule, enabledCompetitions))
  }

  // ─── Hard blocks: registration dates ───

  if (!listing.reg_opens_at) {
    blocks.push('Registration open date is required')
  }

  if (!listing.reg_closes_at) {
    blocks.push('Registration close date is required')
  }

  if (listing.reg_closes_at && listing.feis_date) {
    const closesDate = listing.reg_closes_at.split('T')[0]
    if (closesDate > listing.feis_date) {
      blocks.push('Registration must close before the feis date')
    }
  }

  if (listing.reg_opens_at && listing.reg_closes_at) {
    if (listing.reg_opens_at > listing.reg_closes_at) {
      blocks.push('Registration open date must be before close date')
    }
  }

  if (listing.late_reg_closes_at && listing.reg_closes_at) {
    if (listing.late_reg_closes_at < listing.reg_closes_at) {
      blocks.push(
        'Late registration must close after regular registration'
      )
    }
  }

  // ─── Hard blocks: Stripe ───

  if (!listing.stripe_charges_enabled) {
    blocks.push('Stripe payments must be enabled')
  }

  // ─── Hard blocks: multi-day events ───

  if (
    listing.end_date &&
    listing.feis_date &&
    listing.end_date < listing.feis_date
  ) {
    blocks.push('End date must be on or after the feis start date')
  }

  // ─── Soft warnings ───

  if (feeSchedule && feeSchedule.event_fee_cents === 0) {
    warnings.push('Event fee is $0')
  }

  if (!listing.description) {
    warnings.push('No description provided')
  }

  if (!listing.venue_address) {
    warnings.push('No venue address provided')
  }

  if (listing.reg_opens_at) {
    const now = new Date().toISOString()
    if (listing.reg_opens_at < now) {
      warnings.push('Registration open date is in the past')
    }
  }

  return { blocks, warnings }
}

/**
 * Validation for closed → launched transition.
 */
function getLaunchBlockReasons(
  context: ListingTransitionContext
): PublishValidation {
  const { listing } = context
  const blocks: string[] = []
  const warnings: string[] = []

  if (!listing.feis_date) {
    blocks.push('Feis date is required')
  }

  if ((context.paidRegistrationCount ?? 0) === 0) {
    blocks.push('No paid registrations found. Nothing to launch.')
  }

  if ((context.unsettledRegistrationCount ?? 0) > 0) {
    blocks.push(
      'There are unsettled registrations. All must be paid, expired, or cancelled before launching.'
    )
  }

  return { blocks, warnings }
}
