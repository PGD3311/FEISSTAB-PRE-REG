/**
 * The registrations columns a user's client may read, for PostgREST select(). Must match the column grant in
 * supabase/migrations/012_order_integrity.sql; consent_ip and checkout_config are private and left out.
 * App code reading registrations with a user's client uses this, never `*`, which the database refuses.
 * One string literal, not a joined array, so the Supabase client can still work out the type of what it selects.
 */
export const REGISTRATION_COLUMNS = `
  id, feis_listing_id, household_id, status, confirmation_number,
  stripe_checkout_session_id, stripe_payment_intent_id, stripe_charge_id,
  total_cents, application_fee_cents, event_fee_cents, is_late,
  consent_accepted_at, consent_version, platform_terms_version,
  hold_expires_at, created_at, updated_at, paid_at,
  purchase_snapshot, checkout_claim_id, checkout_claimed_at, checkout_expires_at
`
