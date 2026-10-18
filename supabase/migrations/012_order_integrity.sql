-- 012_order_integrity.sql
-- Payment hardening, part 1: who can write orders, and what never changes.
-- Spec: docs/2026-10-16-payment-hardening-design.md (§2, §3, Rollout step 2)

SET search_path TO pre_registration, public;

-- ─── Leftovers from the parked pay-at-the-door work (011), if they were applied by hand ───
DROP TRIGGER IF EXISTS guard_parent_registration_write ON registrations;
DROP FUNCTION IF EXISTS guard_parent_registration_write();
DROP FUNCTION IF EXISTS confirm_pay_at_door(uuid);
DROP FUNCTION IF EXISTS mark_registration_paid(uuid);

-- ─── New order columns ───
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS purchase_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS checkout_claim_id uuid,
  ADD COLUMN IF NOT EXISTS checkout_config jsonb,
  ADD COLUMN IF NOT EXISTS checkout_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_expires_at timestamptz;

-- ─── Unpaid orders from before purchase snapshots existed ───
-- Rollout step 1 confirms these are test orders with no open Stripe session.
UPDATE registrations
SET status = 'expired', updated_at = now()
WHERE status IN ('draft', 'pending_payment') AND purchase_snapshot IS NULL;

ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_unpaid_needs_purchase_snapshot;
ALTER TABLE registrations ADD CONSTRAINT registrations_unpaid_needs_purchase_snapshot
  CHECK (status NOT IN ('draft', 'pending_payment') OR purchase_snapshot IS NOT NULL);

-- An unpaid order always has a hold, so the expiry job always ends it
ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_unpaid_needs_hold;
ALTER TABLE registrations ADD CONSTRAINT registrations_unpaid_needs_hold
  CHECK (status NOT IN ('draft', 'pending_payment') OR hold_expires_at IS NOT NULL);

-- ─── Uniqueness that confirmation relies on ───
-- One unpaid order per family per feis is 019's idx_registrations_active_unique (draft and pending_payment
-- only). 012–017 never create or drop it, so they apply the same before 019 (live) or after it (the tests);
-- 020 checks it is 019's.
CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_checkout_session_unique
  ON registrations (stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_payment_intent_unique
  ON registrations (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_registration_snapshots_one_per_order
  ON registration_snapshots (registration_id);

-- ─── Read-only access for parents and organisers ───
-- RLS is turned on here as well as in 002: the SELECT grant below depends on it, and the live
-- database was migrated by hand.
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'pre_registration'
      AND tablename IN ('registrations', 'registration_entries', 'registration_snapshots')
  LOOP
    EXECUTE format('DROP POLICY %I ON pre_registration.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- (SELECT auth.uid()) and (SELECT auth_household_id()), as in 007: evaluated once per query, not once per row
CREATE POLICY "Parents read own registrations" ON registrations
  FOR SELECT TO authenticated
  USING (household_id = (SELECT auth_household_id()));

CREATE POLICY "Organisers read registrations for their feiseanna" ON registrations
  FOR SELECT TO authenticated
  USING (feis_listing_id IN (SELECT id FROM feis_listings WHERE created_by = (SELECT auth.uid())));

CREATE POLICY "Parents read own entries" ON registration_entries
  FOR SELECT TO authenticated
  USING (registration_id IN (SELECT id FROM registrations WHERE household_id = (SELECT auth_household_id())));

CREATE POLICY "Organisers read entries for their feiseanna" ON registration_entries
  FOR SELECT TO authenticated
  USING (registration_id IN (
    SELECT r.id FROM registrations r
    JOIN feis_listings l ON l.id = r.feis_listing_id
    WHERE l.created_by = (SELECT auth.uid())
  ));

CREATE POLICY "Parents read own snapshots" ON registration_snapshots
  FOR SELECT TO authenticated
  USING (registration_id IN (SELECT id FROM registrations WHERE household_id = (SELECT auth_household_id())));

CREATE POLICY "Organisers read snapshots for their feiseanna" ON registration_snapshots
  FOR SELECT TO authenticated
  USING (registration_id IN (
    SELECT r.id FROM registrations r
    JOIN feis_listings l ON l.id = r.feis_listing_id
    WHERE l.created_by = (SELECT auth.uid())
  ));

-- REVOKE ALL, not a list of privileges: Postgres 17 added MAINTAIN, and a list written before it would leave it behind.
-- PUBLIC as well: whatever PUBLIC holds, every role holds.
-- On a table, REVOKE ALL also revokes every column-level grant, so a re-run clears the column list below before regranting it.
REVOKE ALL ON registrations, registration_entries, registration_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON registration_entries, registration_snapshots TO authenticated;
-- registrations is granted column by column, and two columns stay private: consent_ip (the parent's IP address)
-- and checkout_config (the bound Stripe account, URLs and idempotency key). Column privileges apply to a role,
-- not to a policy, so organisers can't read them and neither can parents; no parent screen shows them. The payment
-- code reads them through SECURITY DEFINER functions or the service role.
-- Every later migration that adds a registrations column must decide whether to grant SELECT on it: add it to this
-- list and to REGISTRATION_COLUMNS (src/lib/registration-columns.ts), or it stays private.
GRANT SELECT (
  id, feis_listing_id, household_id, status, confirmation_number,
  stripe_checkout_session_id, stripe_payment_intent_id, stripe_charge_id,
  total_cents, application_fee_cents, event_fee_cents, is_late,
  consent_accepted_at, consent_version, platform_terms_version,
  hold_expires_at, created_at, updated_at, paid_at,
  purchase_snapshot, checkout_claim_id, checkout_claimed_at, checkout_expires_at
) ON registrations TO authenticated;
-- Orders are never deleted (spec §3). TRUNCATE skips the row-level delete guards, so the service role
-- loses it too, and the TRUNCATE triggers below refuse it for every role.
REVOKE TRUNCATE ON registrations, registration_entries, registration_snapshots FROM service_role;

-- ─── The state machine (mirrors REGISTRATION_TRANSITIONS in src/lib/registration-states.ts) ───
CREATE OR REPLACE FUNCTION registration_transition_allowed(p_from text, p_to text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pre_registration, pg_temp
AS $$
  SELECT (p_from || '>' || p_to) = ANY (ARRAY[
    'draft>pending_payment', 'draft>cancelled', 'draft>expired', 'draft>paid',
    'pending_payment>paid', 'pending_payment>cancelled', 'pending_payment>expired',
    'expired>paid'
  ])
$$;

-- ─── Orders: created by create_order only; contents fixed; claims and sessions set once ───
CREATE OR REPLACE FUNCTION guard_registrations()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pre_registration, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'orders are never deleted; cancel them instead' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF current_setting('pre_registration.creating_order', true) IS DISTINCT FROM NEW.id::text THEN
      RAISE EXCEPTION 'orders can only be created by create_order' USING ERRCODE = '42501';
    END IF;
    IF NEW.status <> 'draft'
       OR NEW.checkout_claim_id IS NOT NULL OR NEW.checkout_config IS NOT NULL OR NEW.checkout_claimed_at IS NOT NULL
       OR NEW.checkout_expires_at IS NOT NULL
       OR NEW.stripe_checkout_session_id IS NOT NULL OR NEW.stripe_payment_intent_id IS NOT NULL
       OR NEW.stripe_charge_id IS NOT NULL
       OR NEW.confirmation_number IS NOT NULL OR NEW.paid_at IS NOT NULL THEN
      RAISE EXCEPTION 'a new order starts as an unpaid draft' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.id, NEW.household_id, NEW.feis_listing_id, NEW.total_cents, NEW.application_fee_cents,
      NEW.event_fee_cents, NEW.is_late, NEW.purchase_snapshot, NEW.consent_accepted_at,
      NEW.consent_version, NEW.platform_terms_version, NEW.consent_ip, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.household_id, OLD.feis_listing_id, OLD.total_cents, OLD.application_fee_cents,
      OLD.event_fee_cents, OLD.is_late, OLD.purchase_snapshot, OLD.consent_accepted_at,
      OLD.consent_version, OLD.platform_terms_version, OLD.consent_ip, OLD.created_at) THEN
    RAISE EXCEPTION 'an order''s contents never change' USING ERRCODE = '42501';
  END IF;

  IF OLD.checkout_claim_id IS NOT NULL
     AND (NEW.checkout_claim_id, NEW.checkout_config, NEW.checkout_claimed_at, NEW.checkout_expires_at)
         IS DISTINCT FROM (OLD.checkout_claim_id, OLD.checkout_config, OLD.checkout_claimed_at, OLD.checkout_expires_at) THEN
    RAISE EXCEPTION 'a checkout claim is set once' USING ERRCODE = '42501';
  END IF;

  -- A claim is all or nothing: no claim details without a claim, and a new claim brings every detail
  IF (NEW.checkout_claim_id IS NULL
      AND (NEW.checkout_config IS NOT NULL OR NEW.checkout_claimed_at IS NOT NULL OR NEW.checkout_expires_at IS NOT NULL))
     OR (OLD.checkout_claim_id IS NULL AND NEW.checkout_claim_id IS NOT NULL
      AND (NEW.checkout_config IS NULL OR NEW.checkout_claimed_at IS NULL OR NEW.checkout_expires_at IS NULL)) THEN
    RAISE EXCEPTION 'a checkout claim sets its id, config, claim time and expiry together' USING ERRCODE = '42501';
  END IF;

  IF OLD.stripe_checkout_session_id IS NOT NULL
     AND NEW.stripe_checkout_session_id IS DISTINCT FROM OLD.stripe_checkout_session_id THEN
    RAISE EXCEPTION 'a checkout session is attached once' USING ERRCODE = '42501';
  END IF;

  IF OLD.status = 'paid'
     AND (NEW.stripe_payment_intent_id, NEW.stripe_charge_id, NEW.confirmation_number, NEW.paid_at)
         IS DISTINCT FROM (OLD.stripe_payment_intent_id, OLD.stripe_charge_id, OLD.confirmation_number, OLD.paid_at) THEN
    RAISE EXCEPTION 'a paid order''s payment record never changes' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT registration_transition_allowed(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'an order cannot move from % to %', OLD.status, NEW.status USING ERRCODE = '42501';
  END IF;

  -- Payment evidence, checked after the status table so an illegal move still says so. An order above 0 is
  -- paid through its own checkout claim and session. An order that costs nothing is confirmed without Stripe
  -- (confirm_free_order, migration 015): straight from draft, with no claim, session, payment intent or charge.
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    IF NEW.total_cents > 0
       AND (NEW.checkout_claim_id IS NULL OR NEW.stripe_checkout_session_id IS NULL
            OR NEW.paid_at IS NULL OR NEW.confirmation_number IS NULL) THEN
      RAISE EXCEPTION 'a paid order needs its checkout claim, checkout session, payment time and confirmation number'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.total_cents = 0
       AND (OLD.status <> 'draft' OR NEW.paid_at IS NULL OR NEW.confirmation_number IS NULL
            OR NEW.checkout_claim_id IS NOT NULL OR NEW.stripe_checkout_session_id IS NOT NULL
            OR NEW.stripe_payment_intent_id IS NOT NULL OR NEW.stripe_charge_id IS NOT NULL) THEN
      RAISE EXCEPTION 'a free order is paid from a draft, with its payment time and confirmation number and no checkout or payment details'
        USING ERRCODE = '42501';
    END IF;
    -- Every move into paid happens inside _fulfil_order (015), which names the order in this marker before its
    -- paid update. Checked last, so a move the status table or the evidence refuses still says why.
    IF current_setting('pre_registration.fulfilling_order', true) IS DISTINCT FROM NEW.id::text THEN
      RAISE EXCEPTION 'an order is marked paid only by its confirmation' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.status = 'pending_payment' AND OLD.status IS DISTINCT FROM 'pending_payment'
     AND (NEW.checkout_claim_id IS NULL OR NEW.stripe_checkout_session_id IS NULL) THEN
    RAISE EXCEPTION 'an order awaiting payment needs its checkout claim and checkout session' USING ERRCODE = '42501';
  END IF;

  IF OLD.stripe_checkout_session_id IS NULL AND NEW.stripe_checkout_session_id IS NOT NULL
     AND NEW.checkout_claim_id IS NULL THEN
    RAISE EXCEPTION 'a checkout session needs a checkout claim' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_registrations ON registrations;
CREATE TRIGGER guard_registrations
  BEFORE INSERT OR UPDATE OR DELETE ON registrations
  FOR EACH ROW EXECUTE FUNCTION guard_registrations();

-- ─── Entries: written once, inside create_order ───
-- The marker names the order being created, and that order must have been created in this very transaction:
-- created_at defaults to now() (the transaction's start time) and never changes.
CREATE OR REPLACE FUNCTION guard_registration_entries()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pre_registration, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     AND current_setting('pre_registration.creating_order', true) = NEW.registration_id::text
     AND EXISTS (SELECT 1 FROM registrations r WHERE r.id = NEW.registration_id AND r.created_at = now()) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'order entries are fixed when the order is created' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS guard_registration_entries ON registration_entries;
CREATE TRIGGER guard_registration_entries
  BEFORE INSERT OR UPDATE OR DELETE ON registration_entries
  FOR EACH ROW EXECUTE FUNCTION guard_registration_entries();

-- ─── Snapshots: written once, at confirmation ───
-- The marker names the order being fulfilled, and that order must have been marked paid in this very
-- transaction (paid_at = now(); a paid order's payment record never changes afterwards).
CREATE OR REPLACE FUNCTION guard_registration_snapshots()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pre_registration, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     AND current_setting('pre_registration.fulfilling_order', true) = NEW.registration_id::text
     AND EXISTS (SELECT 1 FROM registrations r
                 WHERE r.id = NEW.registration_id AND r.status = 'paid' AND r.paid_at = now()) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'order snapshots are written once, at confirmation' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS guard_registration_snapshots ON registration_snapshots;
CREATE TRIGGER guard_registration_snapshots
  BEFORE INSERT OR UPDATE OR DELETE ON registration_snapshots
  FOR EACH ROW EXECUTE FUNCTION guard_registration_snapshots();

-- ─── TRUNCATE: row-level delete guards don't fire on it, so it is refused for every role ───
CREATE OR REPLACE FUNCTION guard_order_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pre_registration, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'orders are never deleted, so % is never truncated', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS guard_registrations_truncate ON registrations;
CREATE TRIGGER guard_registrations_truncate
  BEFORE TRUNCATE ON registrations
  FOR EACH STATEMENT EXECUTE FUNCTION guard_order_truncate();

DROP TRIGGER IF EXISTS guard_registration_entries_truncate ON registration_entries;
CREATE TRIGGER guard_registration_entries_truncate
  BEFORE TRUNCATE ON registration_entries
  FOR EACH STATEMENT EXECUTE FUNCTION guard_order_truncate();

DROP TRIGGER IF EXISTS guard_registration_snapshots_truncate ON registration_snapshots;
CREATE TRIGGER guard_registration_snapshots_truncate
  BEFORE TRUNCATE ON registration_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION guard_order_truncate();

-- ─── Hold expiry ───
-- pg_cron runs jobs with the default search_path, so the job names its schema.
-- Same rule as 002: an unpaid order whose hold has passed expires.
SELECT cron.schedule('expire-registration-holds', '* * * * *', $$
  UPDATE pre_registration.registrations
  SET status = 'expired', updated_at = now()
  WHERE status IN ('draft', 'pending_payment')
    AND hold_expires_at IS NOT NULL
    AND hold_expires_at < now()
$$);
