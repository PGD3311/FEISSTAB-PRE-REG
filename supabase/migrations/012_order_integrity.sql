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

-- ─── Uniqueness that confirmation relies on ───
CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_checkout_session_unique
  ON registrations (stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_payment_intent_unique
  ON registrations (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_registration_snapshots_one_per_order
  ON registration_snapshots (registration_id);

-- ─── Read-only access for parents and organisers ───
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

CREATE POLICY "Parents read own registrations" ON registrations
  FOR SELECT TO authenticated
  USING (household_id = auth_household_id());

CREATE POLICY "Organisers read registrations for their feiseanna" ON registrations
  FOR SELECT TO authenticated
  USING (feis_listing_id IN (SELECT id FROM feis_listings WHERE created_by = auth.uid()));

CREATE POLICY "Parents read own entries" ON registration_entries
  FOR SELECT TO authenticated
  USING (registration_id IN (SELECT id FROM registrations WHERE household_id = auth_household_id()));

CREATE POLICY "Organisers read entries for their feiseanna" ON registration_entries
  FOR SELECT TO authenticated
  USING (registration_id IN (
    SELECT r.id FROM registrations r
    JOIN feis_listings l ON l.id = r.feis_listing_id
    WHERE l.created_by = auth.uid()
  ));

CREATE POLICY "Parents read own snapshots" ON registration_snapshots
  FOR SELECT TO authenticated
  USING (registration_id IN (SELECT id FROM registrations WHERE household_id = auth_household_id()));

CREATE POLICY "Organisers read snapshots for their feiseanna" ON registration_snapshots
  FOR SELECT TO authenticated
  USING (registration_id IN (
    SELECT r.id FROM registrations r
    JOIN feis_listings l ON l.id = r.feis_listing_id
    WHERE l.created_by = auth.uid()
  ));

-- REVOKE ALL, not a list of privileges: Postgres 17 added MAINTAIN, and a list written before it would leave it behind.
REVOKE ALL ON registrations, registration_entries, registration_snapshots FROM anon, authenticated;
GRANT SELECT ON registrations, registration_entries, registration_snapshots TO authenticated;

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
