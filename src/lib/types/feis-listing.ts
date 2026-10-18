import type { PurchaseSnapshot } from '@/lib/engine/purchase-snapshot'

// Listing status
export type ListingStatus = 'draft' | 'open' | 'closed' | 'launched'

// Fee category — maps to fee_schedule columns
export type FeeCategoryType = 'solo' | 'prelim_champ' | 'open_champ'

// Competition type in syllabus
export type CompetitionType = 'solo' | 'championship' | 'special' | 'custom'

// Championship key
export type ChampionshipKey = 'prelim' | 'open'

// ─── Template data types ───

export interface AgeGroup {
  key: string
  label: string
  max_age_jan1?: number
  min_age_jan1?: number
}

export interface Level {
  key: string
  label: string
  rank: number
}

export interface Dance {
  key: string
  label: string
  type: 'light' | 'heavy' | 'set'
}

export interface ChampionshipType {
  key: string
  label: string
  eligible_levels: string[]
  requires_championship_status?: boolean
  fee_category: string
}

export interface Special {
  key: string
  label: string
  type: string
}

export interface TemplateData {
  age_groups: AgeGroup[]
  levels: Level[]
  dances: Dance[]
  championship_types: ChampionshipType[]
  specials: Special[]
  // Which dances each level usually offers, e.g. no treble jig for Beginners
  default_level_dances?: Record<string, string[]>
}

// ─── Feis listing types ───

export interface FeisListing {
  id: string
  name: string | null
  feis_date: string | null
  end_date: string | null
  venue_name: string | null
  venue_address: string | null
  contact_email: string | null
  contact_phone: string | null
  description: string | null
  timezone: string | null
  age_cutoff_date: string | null
  sanctioning_body: string
  season_year: number | null
  status: ListingStatus
  reg_opens_at: string | null
  reg_closes_at: string | null
  late_reg_closes_at: string | null
  dancer_cap: number | null
  syllabus_template_id: string | null
  syllabus_snapshot: TemplateData | null
  cloned_from: string | null
  stripe_account_id: string | null
  stripe_onboarding_complete: boolean
  stripe_charges_enabled: boolean
  stripe_payouts_enabled: boolean
  privacy_policy_url: string | null
  terms_url: string | null
  website_url: string | null
  logo_url: string | null
  accepted_dpa_at: string | null
  show_contact_publicly: boolean
  launched_at: string | null
  launched_event_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// ─── Fee schedule types ───

export interface LateFeeTier {
  starts_at: string // ISO timestamp; the tier applies from this moment on
  fee_cents: number // charged per dancer
  family_max_cents: number | null // most one family pays at this tier; null = no max
}

export interface FeeSchedule {
  id: string
  feis_listing_id: string
  event_fee_cents: number
  solo_fee_cents: number
  prelim_champ_fee_cents: number
  open_champ_fee_cents: number
  // Most a family pays in competition entry fees. Excludes the event fee, late fees,
  // day-of surcharges and competitions marked exclude_from_family_cap.
  family_cap_cents: number | null
  late_fee_tiers: LateFeeTier[]
  day_of_surcharge_cents: number
}

// ─── Fee calculator types ───

export interface FeeEntry {
  dancer_id: string
  fee_category: FeeCategoryType
  fee_cents_override?: number | null // per-competition price, e.g. Future Champ or a team
  exclude_from_family_cap?: boolean
  is_day_of: boolean
}

/** What the family has already paid for this feis, so an added order isn't charged twice. */
export interface PriorPaidFees {
  /** The once-per-family event fee was paid in an earlier order */
  event_fee_paid: boolean
  /** Entry fees already paid that count toward the family max */
  cappable_paid_cents: number
  /** Dancers already charged a late fee */
  late_fee_dancer_ids: string[]
  /** Late fees already paid, for the late tier's family max */
  late_fees_paid_cents: number
}

export interface FeeLineItem {
  dancer_id: string
  base_fee_cents: number
  late_fee_cents: number
  day_of_surcharge_cents: number
  line_total_cents: number
  counts_toward_family_cap: boolean
}

export interface FeeBreakdown {
  line_items: FeeLineItem[]
  event_fee_cents: number
  subtotal_per_dancer: Record<string, number>
  late_fees_cents: number
  active_late_tier: LateFeeTier | null
  subtotal_before_cap_cents: number
  family_cap_applied: boolean
  family_cap_savings_cents: number
  grand_total_cents: number
}

// ─── Syllabus expander types ───

export interface SyllabusSelection {
  enabled_age_groups: string[]
  enabled_levels: string[]
  enabled_dances: string[]
  enable_prelim: boolean
  prelim_age_groups: string[]
  enable_open: boolean
  open_age_groups: string[]
  enable_specials: string[]
  // Dances offered per level. When absent, every enabled level gets every enabled dance.
  level_dances?: Record<string, string[]>
}

export interface ExpandedCompetition {
  age_group_key: string | null
  age_group_label: string | null
  age_max_jan1: number | null
  age_min_jan1: number | null
  level_key: string | null
  level_label: string | null
  dance_key: string | null
  dance_label: string | null
  competition_type: CompetitionType
  championship_key: ChampionshipKey | null
  fee_category: FeeCategoryType
  display_name: string
  display_code: string | null
  sort_order: number
}

// ─── State machine types ───

export interface PublishValidation {
  blocks: string[]
  warnings: string[]
}

export interface ListingTransitionContext {
  listing: FeisListing
  feeSchedule: FeeSchedule | null
  enabledCompetitions: {
    competition_type: CompetitionType
    championship_key: ChampionshipKey | null
    fee_category: FeeCategoryType
  }[]
  // Launch context (closed → launched)
  paidRegistrationCount?: number
  unsettledRegistrationCount?: number
}

// ─── Registration status ───
export type RegistrationStatus = 'draft' | 'pending_payment' | 'paid' | 'expired' | 'cancelled'

// ─── Championship status ───
export type ChampionshipStatus = 'none' | 'prelim' | 'open'

// ─── Household (family account) ───
export interface Household {
  id: string
  user_id: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state_region: string | null
  postal_code: string | null
  country: string
}

// ─── Dancer types ───
export interface Dancer {
  id: string
  household_id: string
  first_name: string
  last_name: string
  date_of_birth: string  // ISO date
  gender: 'female' | 'male'
  school_name: string | null
  /** Link to the shared schools list (migration 018); school_name stays the stored name */
  school_id?: string | null
  /** 'guest' = someone else's child the account holder enters (migration 018) */
  relationship?: 'household' | 'guest'
  tcrg_name: string | null
  championship_status: ChampionshipStatus
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface DancerDanceLevel {
  id: string
  dancer_id: string
  dance_key: string
  level_key: string
  source: 'parent' | 'teacher'
  updated_at: string
}

// ─── Registration types ───
// The columns of REGISTRATION_COLUMNS the app may read. consent_ip and checkout_config are private to the database.
export interface Registration {
  id: string
  feis_listing_id: string
  household_id: string
  status: RegistrationStatus
  confirmation_number: string | null
  stripe_checkout_session_id: string | null
  stripe_payment_intent_id: string | null
  stripe_charge_id: string | null
  total_cents: number
  application_fee_cents: number
  event_fee_cents: number
  is_late: boolean
  consent_accepted_at: string | null
  consent_version: string | null
  platform_terms_version: string | null
  hold_expires_at: string | null
  /** What the order was checked and priced on, frozen at Submit; null on orders from before that */
  purchase_snapshot: PurchaseSnapshot | null
  checkout_claim_id: string | null
  checkout_expires_at: string | null
  paid_at: string | null
  created_at: string
  updated_at: string
}

export interface RegistrationEntry {
  id: string
  registration_id: string
  dancer_id: string
  feis_competition_id: string
  fee_category: FeeCategoryType
  base_fee_cents: number
  late_fee_cents: number
  day_of_surcharge_cents: number
  created_at: string
}

// ─── Eligibility types ───
export interface DanceLevelMap {
  [danceKey: string]: string  // e.g., { reel: 'NOV', slip_jig: 'AB' }
}

export interface DancerProfile {
  dob: Date
  gender: string
  championshipStatus: ChampionshipStatus
  danceLevels: DanceLevelMap
}

// Represents a feis_competitions database row — the canonical shape for
// eligibility filtering, cart building, and capacity checks.
export interface FeisCompetition {
  id: string
  feis_listing_id: string
  age_group_key: string | null
  age_group_label: string | null
  age_max_jan1: number | null
  age_min_jan1: number | null
  level_key: string | null
  level_label: string | null
  dance_key: string | null
  dance_label: string | null
  competition_type: CompetitionType
  championship_key: ChampionshipKey | null
  fee_category: FeeCategoryType
  fee_cents: number | null
  exclude_from_family_cap: boolean
  grades_only: boolean
  display_name: string
  display_code: string | null
  capacity_cap: number | null
  enabled: boolean
}

export interface EligibleCompetition {
  competition: FeisCompetition
  eligible: boolean
  reason: string  // e.g., "Age and level match", "Championship status insufficient"
}
