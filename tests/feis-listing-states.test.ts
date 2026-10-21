import { describe, it, expect } from 'vitest'
import {
  canTransitionListing,
  getFeeBlockReasons,
  getNextListingStates,
  getListingTransitionBlockReasons,
} from '@/lib/feis-listing-states'
import type {
  ListingTransitionContext,
  FeisListing,
  FeeSchedule,
} from '@/lib/types/feis-listing'

// ─── Test helpers ───

function validListing(overrides: Partial<FeisListing> = {}): FeisListing {
  return {
    id: 'feis-001',
    name: 'Test Feis 2026',
    feis_date: '2099-06-15',
    end_date: null,
    venue_name: 'Community Center',
    venue_address: '123 Main St',
    contact_email: 'org@example.com',
    contact_phone: '555-1234',
    description: 'A great feis',
    timezone: 'America/New_York',
    age_cutoff_date: '2026-01-01',
    sanctioning_body: 'CLRG',
    season_year: 2026,
    status: 'draft',
    reg_opens_at: '2025-01-01T00:00:00Z',
    reg_closes_at: '2099-06-01T00:00:00Z',
    late_reg_closes_at: null,
    dancer_cap: null,
    syllabus_template_id: null,
    syllabus_snapshot: null,
    cloned_from: null,
    stripe_account_id: 'acct_123',
    stripe_onboarding_complete: true,
    stripe_charges_enabled: true,
    stripe_payouts_enabled: true,
    privacy_policy_url: 'https://example.com/privacy',
    terms_url: null,
    website_url: null,
    logo_url: null,
    accepted_dpa_at: null,
    show_contact_publicly: true,
    launched_at: null,
    launched_event_id: null,
    submitted_at: null,
    approved_at: null,
    approved_by: null,
    review_note: null,
    sanction_region: 'Mid-Atlantic',
    sanction_reference: 'MA-2099-014',
    sanction_notes: null,
    created_by: 'user-001',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

function validFeeSchedule(): FeeSchedule {
  return {
    id: 'fee-001',
    feis_listing_id: 'feis-001',
    event_fee_cents: 2500,
    solo_fee_cents: 1300,
    prelim_champ_fee_cents: 5500,
    open_champ_fee_cents: 6000,
    family_cap_cents: 15000,
    late_fee_tiers: [{ starts_at: '2026-05-01T00:00:00Z', fee_cents: 2500, family_max_cents: null }],
    day_of_surcharge_cents: 5000,
  }
}

function validContext(
  overrides: Partial<ListingTransitionContext> = {}
): ListingTransitionContext {
  return {
    listing: validListing(),
    feeSchedule: validFeeSchedule(),
    enabledCompetitions: [
      {
        competition_type: 'solo',
        championship_key: null,
        fee_category: 'solo',
      },
    ],
    hasOrganiserProfile: true,
    ...overrides,
  }
}

// ─── Tests ───

describe('canTransitionListing', () => {
  it('allows an owner to submit a draft for approval', () => {
    expect(canTransitionListing('draft', 'pending_review')).toBe(true)
  })

  it('allows an owner to withdraw a feis waiting for approval', () => {
    expect(canTransitionListing('pending_review', 'draft')).toBe(true)
  })

  it('refuses draft → open for everyone: a feis opens only through approval', () => {
    expect(canTransitionListing('draft', 'open')).toBe(false)
    expect(canTransitionListing('draft', 'open', 'admin')).toBe(false)
  })

  it('refuses an owner approving their own feis (pending_review → open)', () => {
    expect(canTransitionListing('pending_review', 'open')).toBe(false)
  })

  it('allows an admin to approve (→ open) or send back (→ draft) a pending feis', () => {
    expect(canTransitionListing('pending_review', 'open', 'admin')).toBe(true)
    expect(canTransitionListing('pending_review', 'draft', 'admin')).toBe(true)
  })

  it('gives an admin no other moves', () => {
    expect(canTransitionListing('draft', 'pending_review', 'admin')).toBe(false)
    expect(canTransitionListing('open', 'closed', 'admin')).toBe(false)
    expect(canTransitionListing('closed', 'open', 'admin')).toBe(false)
  })

  it('allows open → closed', () => {
    expect(canTransitionListing('open', 'closed')).toBe(true)
  })

  it('allows closed → open (reopen)', () => {
    expect(canTransitionListing('closed', 'open')).toBe(true)
  })

  it('rejects draft → closed (must go through open)', () => {
    expect(canTransitionListing('draft', 'closed')).toBe(false)
  })

  it('rejects pending_review → closed or launched', () => {
    expect(canTransitionListing('pending_review', 'closed')).toBe(false)
    expect(canTransitionListing('pending_review', 'launched')).toBe(false)
  })

  it('rejects open → draft (no going back to draft)', () => {
    expect(canTransitionListing('open', 'draft')).toBe(false)
  })

  it('rejects open → pending_review (an approved feis is not resubmitted)', () => {
    expect(canTransitionListing('open', 'pending_review')).toBe(false)
  })

  it('allows closed -> launched', () => {
    expect(canTransitionListing('closed', 'launched')).toBe(true)
  })

  it('rejects launched -> any (terminal state)', () => {
    expect(canTransitionListing('launched', 'draft')).toBe(false)
    expect(canTransitionListing('launched', 'open')).toBe(false)
    expect(canTransitionListing('launched', 'closed')).toBe(false)
    expect(canTransitionListing('launched', 'pending_review')).toBe(false)
  })

  it('rejects same-state transitions', () => {
    expect(canTransitionListing('draft', 'draft')).toBe(false)
    expect(canTransitionListing('pending_review', 'pending_review')).toBe(false)
    expect(canTransitionListing('open', 'open')).toBe(false)
    expect(canTransitionListing('closed', 'closed')).toBe(false)
  })
})

describe('getNextListingStates', () => {
  it('returns [pending_review] for draft', () => {
    expect(getNextListingStates('draft')).toEqual(['pending_review'])
  })

  it('returns [draft] for pending_review: the owner can only withdraw', () => {
    expect(getNextListingStates('pending_review')).toEqual(['draft'])
  })

  it('returns [open, draft] for pending_review when the actor is an admin', () => {
    expect(getNextListingStates('pending_review', 'admin')).toEqual(['open', 'draft'])
  })

  it('returns [closed] for open', () => {
    expect(getNextListingStates('open')).toEqual(['closed'])
  })

  it('returns [open, launched] for closed', () => {
    expect(getNextListingStates('closed')).toEqual(['open', 'launched'])
  })

  it('returns [] for launched (terminal)', () => {
    expect(getNextListingStates('launched')).toEqual([])
  })
})

describe('getListingTransitionBlockReasons', () => {
  describe('non-draft transitions return empty', () => {
    it('open → closed has no blocks or warnings', () => {
      const result = getListingTransitionBlockReasons(
        'open',
        'closed',
        validContext()
      )
      expect(result.blocks).toEqual([])
      expect(result.warnings).toEqual([])
    })

    it('closed → open has no blocks or warnings once RunFeis has approved the feis', () => {
      const result = getListingTransitionBlockReasons(
        'closed',
        'open',
        validContext({
          listing: validListing({ status: 'closed', approved_at: '2026-10-20T12:00:00Z' }),
        })
      )
      expect(result.blocks).toEqual([])
      expect(result.warnings).toEqual([])
    })

    it('withdraw (pending_review → draft) has no blocks or warnings', () => {
      const result = getListingTransitionBlockReasons(
        'pending_review',
        'draft',
        validContext({ listing: validListing({ status: 'pending_review' }) })
      )
      expect(result.blocks).toEqual([])
      expect(result.warnings).toEqual([])
    })
  })

  describe('closed → open needs an earlier approval', () => {
    it('blocks reopening a feis RunFeis never approved', () => {
      const result = getListingTransitionBlockReasons(
        'closed',
        'open',
        validContext({ listing: validListing({ status: 'closed', approved_at: null }) })
      )
      expect(result.blocks).toContain('RunFeis has not approved this feis')
    })
  })

  describe('submitting for approval', () => {
    it('runs the publish checks on draft → pending_review', () => {
      const ctx = validContext({ listing: validListing({ name: null }) })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain('Feis name is required')
    })

    it('no longer runs the publish checks on draft → open', () => {
      const ctx = validContext({ listing: validListing({ name: null }) })
      const result = getListingTransitionBlockReasons('draft', 'open', ctx)
      expect(result.blocks).toEqual([])
    })

    it('blocks when the sanction region is missing', () => {
      const ctx = validContext({ listing: validListing({ sanction_region: null }) })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain('Sanction region is required')
    })

    it('blocks when the sanction region is blank', () => {
      const ctx = validContext({ listing: validListing({ sanction_region: '   ' }) })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain('Sanction region is required')
    })

    it('blocks when the sanction reference is missing', () => {
      const ctx = validContext({ listing: validListing({ sanction_reference: null }) })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain('Sanction reference is required')
    })

    it('blocks when the sanction reference is blank', () => {
      const ctx = validContext({ listing: validListing({ sanction_reference: ' ' }) })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain('Sanction reference is required')
    })

    it('blocks when the organiser details are missing', () => {
      const ctx = validContext({ hasOrganiserProfile: false })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain('Your organiser details are required')
    })

    it('does not need sanction notes', () => {
      const ctx = validContext({ listing: validListing({ sanction_notes: null }) })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toEqual([])
    })
  })

  describe('valid listing passes with no blocks', () => {
    it('returns no blocks for a fully valid listing', () => {
      const result = getListingTransitionBlockReasons(
        'draft',
        'pending_review',
        validContext()
      )
      expect(result.blocks).toEqual([])
    })
  })

  describe('hard blocks — missing required fields', () => {
    it('blocks when name is missing', () => {
      const ctx = validContext({
        listing: validListing({ name: null }),
      })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain('Feis name is required')
    })

    it('blocks when feis_date is missing', () => {
      const ctx = validContext({
        listing: validListing({ feis_date: null }),
      })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain('Feis date is required')
    })

    it('blocks when feis_date is in the past', () => {
      const ctx = validContext({
        listing: validListing({ feis_date: '2020-01-01' }),
      })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain('Feis date must be in the future')
    })

    it('blocks when venue_name is missing', () => {
      const ctx = validContext({
        listing: validListing({ venue_name: null }),
      })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain('Venue name is required')
    })

    it('blocks when contact_email is missing', () => {
      const ctx = validContext({
        listing: validListing({ contact_email: null }),
      })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain('Contact email is required')
    })

    it('blocks when timezone is missing', () => {
      const ctx = validContext({
        listing: validListing({ timezone: null }),
      })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain('Timezone is required')
    })

    it('blocks when privacy_policy_url is missing', () => {
      const ctx = validContext({
        listing: validListing({ privacy_policy_url: null }),
      })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain('Privacy policy URL is required')
    })
  })

  describe('hard blocks — competitions', () => {
    it('blocks when no enabled competitions', () => {
      const ctx = validContext({ enabledCompetitions: [] })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain('At least one competition must be enabled')
    })
  })

  describe('hard blocks — fee schedule', () => {
    it('blocks when fee schedule is missing', () => {
      const ctx = validContext({ feeSchedule: null })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain('Fee schedule is required')
    })

    it('blocks when solo fee is $0 and solo competitions exist', () => {
      const ctx = validContext({
        feeSchedule: { ...validFeeSchedule(), solo_fee_cents: 0 },
        enabledCompetitions: [
          {
            competition_type: 'solo',
            championship_key: null,
            fee_category: 'solo',
          },
        ],
      })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain(
        'Solo fee must be greater than $0 when solo competitions exist'
      )
    })

    it('blocks when prelim champ fee is $0 and championship competitions with prelim key exist', () => {
      const ctx = validContext({
        feeSchedule: { ...validFeeSchedule(), prelim_champ_fee_cents: 0 },
        enabledCompetitions: [
          {
            competition_type: 'championship',
            championship_key: 'prelim',
            fee_category: 'prelim_champ',
          },
        ],
      })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain(
        'Championship fee must be greater than $0 when championship competitions exist'
      )
    })

    it('blocks when open champ fee is $0 and championship competitions with open key exist', () => {
      const ctx = validContext({
        feeSchedule: { ...validFeeSchedule(), open_champ_fee_cents: 0 },
        enabledCompetitions: [
          {
            competition_type: 'championship',
            championship_key: 'open',
            fee_category: 'open_champ',
          },
        ],
      })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain(
        'Championship fee must be greater than $0 when championship competitions exist'
      )
    })

    it('does not block solo fee $0 when no solo competitions', () => {
      const ctx = validContext({
        feeSchedule: { ...validFeeSchedule(), solo_fee_cents: 0 },
        enabledCompetitions: [
          {
            competition_type: 'championship',
            championship_key: 'prelim',
            fee_category: 'prelim_champ',
          },
        ],
      })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).not.toContain(
        'Solo fee must be greater than $0 when solo competitions exist'
      )
    })
  })

  describe('hard blocks — registration dates', () => {
    it('blocks when reg_opens_at is missing', () => {
      const ctx = validContext({
        listing: validListing({ reg_opens_at: null }),
      })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain(
        'Registration open date is required'
      )
    })

    it('blocks when reg_closes_at is missing', () => {
      const ctx = validContext({
        listing: validListing({ reg_closes_at: null }),
      })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain(
        'Registration close date is required'
      )
    })

    it('blocks when reg_closes_at is after feis_date', () => {
      const ctx = validContext({
        listing: validListing({
          feis_date: '2099-06-15',
          reg_closes_at: '2099-06-20T00:00:00Z',
        }),
      })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain(
        'Registration must close before the feis date'
      )
    })

    it('blocks when reg_opens_at is after reg_closes_at', () => {
      const ctx = validContext({
        listing: validListing({
          reg_opens_at: '2099-06-10T00:00:00Z',
          reg_closes_at: '2099-06-05T00:00:00Z',
        }),
      })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain(
        'Registration open date must be before close date'
      )
    })

    it('blocks when late_reg_closes_at is before reg_closes_at', () => {
      const ctx = validContext({
        listing: validListing({
          reg_closes_at: '2099-06-10T00:00:00Z',
          late_reg_closes_at: '2099-06-05T00:00:00Z',
        }),
      })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain(
        'Late registration must close after regular registration'
      )
    })
  })

  describe('hard blocks — Stripe', () => {
    it('blocks when stripe_charges_enabled is false', () => {
      const ctx = validContext({
        listing: validListing({ stripe_charges_enabled: false }),
      })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain(
        'Stripe payments must be enabled'
      )
    })
  })

  describe('hard blocks — multi-day events', () => {
    it('blocks when end_date is before feis_date', () => {
      const ctx = validContext({
        listing: validListing({
          feis_date: '2099-06-15',
          end_date: '2099-06-14',
        }),
      })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toContain(
        'End date must be on or after the feis start date'
      )
    })

    it('does not block when end_date equals feis_date', () => {
      const ctx = validContext({
        listing: validListing({
          feis_date: '2099-06-15',
          end_date: '2099-06-15',
        }),
      })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).not.toContain(
        'End date must be on or after the feis start date'
      )
    })

    it('does not block when end_date is null', () => {
      const ctx = validContext({
        listing: validListing({ end_date: null }),
      })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).not.toContain(
        'End date must be on or after the feis start date'
      )
    })
  })

  describe('closed -> launched validation', () => {
    it('blocks when feis_date is missing', () => {
      const ctx = validContext({
        listing: validListing({ status: 'closed', feis_date: null }),
        paidRegistrationCount: 5,
        unsettledRegistrationCount: 0,
      })
      const result = getListingTransitionBlockReasons('closed', 'launched', ctx)
      expect(result.blocks).toContain('Feis date is required')
    })

    it('blocks when no paid registrations', () => {
      const ctx = validContext({
        listing: validListing({ status: 'closed' }),
        paidRegistrationCount: 0,
        unsettledRegistrationCount: 0,
      })
      const result = getListingTransitionBlockReasons('closed', 'launched', ctx)
      expect(result.blocks).toContain(
        'No paid registrations found. Nothing to launch.'
      )
    })

    it('blocks when unsettled registrations exist', () => {
      const ctx = validContext({
        listing: validListing({ status: 'closed' }),
        paidRegistrationCount: 5,
        unsettledRegistrationCount: 2,
      })
      const result = getListingTransitionBlockReasons('closed', 'launched', ctx)
      expect(result.blocks).toContain(
        'There are unsettled registrations. All must be paid, expired, or cancelled before launching.'
      )
    })

    it('passes when all prerequisites met', () => {
      const ctx = validContext({
        listing: validListing({ status: 'closed' }),
        paidRegistrationCount: 10,
        unsettledRegistrationCount: 0,
      })
      const result = getListingTransitionBlockReasons('closed', 'launched', ctx)
      expect(result.blocks).toEqual([])
    })
  })

  describe('soft warnings', () => {
    it('warns when event_fee_cents is 0', () => {
      const ctx = validContext({
        feeSchedule: { ...validFeeSchedule(), event_fee_cents: 0 },
      })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toEqual([])
      expect(result.warnings).toContain('Event fee is $0')
    })

    it('warns when description is null', () => {
      const ctx = validContext({
        listing: validListing({ description: null }),
      })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toEqual([])
      expect(result.warnings).toContain('No description provided')
    })

    it('warns when venue_address is null', () => {
      const ctx = validContext({
        listing: validListing({ venue_address: null }),
      })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toEqual([])
      expect(result.warnings).toContain('No venue address provided')
    })

    it('warns when reg_opens_at is in the past', () => {
      const ctx = validContext({
        listing: validListing({
          reg_opens_at: '2020-01-01T00:00:00Z',
        }),
      })
      const result = getListingTransitionBlockReasons('draft', 'pending_review', ctx)
      expect(result.blocks).toEqual([])
      expect(result.warnings).toContain(
        'Registration open date is in the past'
      )
    })
  })
})

describe('getFeeBlockReasons', () => {
  const fees = { solo_fee_cents: 1300, prelim_champ_fee_cents: 5500, open_champ_fee_cents: 6000 }

  it('passes when every offered category has a fee', () => {
    const offered = [{ fee_category: 'solo' as const }, { fee_category: 'open_champ' as const }]
    expect(getFeeBlockReasons(fees, offered)).toEqual([])
  })

  it('blocks a $0 solo fee when solo competitions exist', () => {
    expect(getFeeBlockReasons({ ...fees, solo_fee_cents: 0 }, [{ fee_category: 'solo' }])).toEqual([
      'Solo fee must be greater than $0 when solo competitions exist'
    ])
  })

  it('blocks a $0 championship fee for the championships offered', () => {
    const zero = { ...fees, prelim_champ_fee_cents: 0, open_champ_fee_cents: 0 }
    expect(getFeeBlockReasons(zero, [{ fee_category: 'prelim_champ' }])).toHaveLength(1)
    expect(getFeeBlockReasons(zero, [{ fee_category: 'open_champ' }])).toHaveLength(1)
  })

  it('allows $0 for a category the feis does not offer', () => {
    const zero = { solo_fee_cents: 0, prelim_champ_fee_cents: 0, open_champ_fee_cents: 0 }
    expect(getFeeBlockReasons(zero, [])).toEqual([])
  })
})
