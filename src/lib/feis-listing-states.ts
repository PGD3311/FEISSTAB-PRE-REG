import type {
  ListingStatus,
  ListingTransitionContext,
  PublishValidation,
} from '@/lib/types/feis-listing'

// ─── Transition map ───

const VALID_TRANSITIONS: Record<ListingStatus, ListingStatus[]> = {
  draft: ['open'],
  open: ['closed'],
  closed: ['open'],
}

// ─── Public API ───

/**
 * Check whether a status transition is allowed.
 */
export function canTransitionListing(
  from: ListingStatus,
  to: ListingStatus
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Return the list of valid next states for a given status.
 */
export function getNextListingStates(
  current: ListingStatus
): ListingStatus[] {
  return VALID_TRANSITIONS[current] ?? []
}

/**
 * Return publish-gate validation: hard blocks and soft warnings.
 * Only enforced on draft → open. All other transitions pass unconditionally.
 */
export function getListingTransitionBlockReasons(
  from: ListingStatus,
  to: ListingStatus,
  context: ListingTransitionContext
): PublishValidation {
  if (from !== 'draft' || to !== 'open') {
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

  // ─── Hard blocks: competitions ───

  if (enabledCompetitions.length === 0) {
    blocks.push('At least one competition must be enabled')
  }

  // ─── Hard blocks: fee schedule ───

  if (!feeSchedule) {
    blocks.push('Fee schedule is required')
  } else {
    const hasSolo = enabledCompetitions.some(
      (c) => c.fee_category === 'solo'
    )
    if (hasSolo && feeSchedule.solo_fee_cents === 0) {
      blocks.push(
        'Solo fee must be greater than $0 when solo competitions exist'
      )
    }

    const hasPrelimChamp = enabledCompetitions.some(
      (c) => c.fee_category === 'prelim_champ'
    )
    if (hasPrelimChamp && feeSchedule.prelim_champ_fee_cents === 0) {
      blocks.push(
        'Championship fee must be greater than $0 when championship competitions exist'
      )
    }

    const hasOpenChamp = enabledCompetitions.some(
      (c) => c.fee_category === 'open_champ'
    )
    if (hasOpenChamp && feeSchedule.open_champ_fee_cents === 0) {
      blocks.push(
        'Championship fee must be greater than $0 when championship competitions exist'
      )
    }
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
