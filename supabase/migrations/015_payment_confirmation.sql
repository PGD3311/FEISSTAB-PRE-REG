-- 015_payment_confirmation.sql
-- Payment hardening, part 4: confirmation is one transaction; anything that doesn't add up becomes
-- a durable case with a reference, an alert and a restricted parent view. Spec §9, §10, §12.

SET search_path TO pre_registration, public;

CREATE TABLE IF NOT EXISTS payment_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  support_ref text NOT NULL UNIQUE,
  severity text NOT NULL CHECK (severity IN ('blocking', 'notice')),
  reason text NOT NULL CHECK (reason IN (
    'amount_mismatch', 'currency_mismatch', 'account_mismatch', 'claim_mismatch', 'session_mismatch',
    'payment_reused', 'order_not_payable', 'late_payment_conflict', 'order_not_found', 'payment_failed',
    'listing_account_changed')),
  registration_id uuid REFERENCES registrations(id),
  household_id uuid REFERENCES households(id),
  feis_listing_id uuid REFERENCES feis_listings(id),
  claim_id uuid,
  stripe_event_id text,
  stripe_account_id text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  amount_cents integer,
  currency text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution text CHECK (resolution IN ('refunded', 'no_action', 'acknowledged', 'confirmed_late_payment')),
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_exceptions_one_per_session_reason UNIQUE NULLS NOT DISTINCT (stripe_checkout_session_id, reason)
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('registration_confirmation', 'payment_exception_alert', 'delivery_failure_alert')),
  dedupe_key text NOT NULL UNIQUE,
  registration_id uuid REFERENCES registrations(id),
  exception_id uuid REFERENCES payment_exceptions(id),
  related_notification_id uuid REFERENCES notifications(id),
  recipient text,
  payload jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'needs_check')),
  attempts integer NOT NULL DEFAULT 0,
  send_generation integer NOT NULL DEFAULT 0,
  last_outcome text CHECK (last_outcome IN ('sent', 'explicit_failure', 'uncertain')),
  first_attempt_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claim_token uuid,
  claimed_at timestamptz,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_due ON notifications (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_payment_exceptions_registration ON payment_exceptions (registration_id);

ALTER TABLE payment_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
-- PUBLIC as well, as in 012: whatever PUBLIC holds, every role holds
REVOKE ALL ON payment_exceptions, notifications FROM PUBLIC, anon, authenticated;

-- ─── References ───
CREATE OR REPLACE FUNCTION _random_code(p_length integer)
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = pre_registration, pg_temp
AS $$
  SELECT string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
  FROM generate_series(1, p_length)
$$;

-- The year is the one the family is in: RunFeis runs Northeast feiseanna only, so it is taken in
-- Eastern time, not UTC (a payment at 9pm on New Year's Eve in Boston keeps the old year).
-- p_at is there for the tests; payments always use now().
CREATE OR REPLACE FUNCTION new_confirmation_number(p_at timestamptz DEFAULT now())
RETURNS text
LANGUAGE plpgsql
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_code text;
BEGIN
  LOOP
    v_code := 'RF-' || extract(year FROM p_at AT TIME ZONE 'America/New_York')::int || '-' || _random_code(5);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM registrations WHERE confirmation_number = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION new_support_ref()
RETURNS text
LANGUAGE plpgsql
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_code text;
BEGIN
  LOOP
    v_code := 'PAY-' || _random_code(5);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM payment_exceptions WHERE support_ref = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

-- ─── Cases: one per session and reason, each with an alert queued ───
CREATE OR REPLACE FUNCTION _record_payment_exception(
  p_severity text, p_reason text, p_registration_id uuid, p_claim_id uuid, p_event_id text, p_account text,
  p_session_id text, p_payment_intent_id text, p_amount_cents integer, p_currency text, p_details jsonb)
RETURNS text
LANGUAGE plpgsql
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_ref text;
  v_household uuid;
  v_listing uuid;
BEGIN
  IF p_registration_id IS NOT NULL THEN
    SELECT household_id, feis_listing_id INTO v_household, v_listing FROM registrations WHERE id = p_registration_id;
  END IF;

  INSERT INTO payment_exceptions (support_ref, severity, reason, registration_id, household_id, feis_listing_id,
    claim_id, stripe_event_id, stripe_account_id, stripe_checkout_session_id, stripe_payment_intent_id,
    amount_cents, currency, details)
  VALUES (new_support_ref(), p_severity, p_reason, p_registration_id, v_household, v_listing,
    p_claim_id, p_event_id, p_account, p_session_id, p_payment_intent_id,
    p_amount_cents, lower(p_currency), coalesce(p_details, '{}'::jsonb))
  ON CONFLICT ON CONSTRAINT payment_exceptions_one_per_session_reason DO NOTHING
  RETURNING id, support_ref INTO v_id, v_ref;

  IF v_id IS NULL THEN
    -- A repeat delivery of a case we already have
    SELECT support_ref INTO v_ref FROM payment_exceptions
    WHERE stripe_checkout_session_id IS NOT DISTINCT FROM p_session_id AND reason = p_reason;
    RETURN v_ref;
  END IF;

  INSERT INTO notifications (kind, dedupe_key, registration_id, exception_id)
  VALUES ('payment_exception_alert', 'exception:' || v_id, p_registration_id, v_id)
  ON CONFLICT (dedupe_key) DO NOTHING;

  RETURN v_ref;
END;
$$;

-- ─── Fulfilment: every step or none. Callers hold the household-and-feis lock and the order row. ───
CREATE OR REPLACE FUNCTION _fulfil_order(p_registration_id uuid, p_session_id text, p_payment_intent_id text,
  p_charge_id text, p_amount_cents integer, p_currency text)
RETURNS text
LANGUAGE plpgsql
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_order registrations%ROWTYPE;
  v_number text := new_confirmation_number();
  v_email text;
BEGIN
  -- One UPDATE sets every payment field with the status: 012 needs the claim, session, payment time and
  -- confirmation number to arrive with 'paid', and freezes them from then on. The snapshot below is
  -- written in this same transaction, as 012's snapshot guard requires (paid_at = now()).
  UPDATE registrations
  SET status = 'paid',
      stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id),
      stripe_payment_intent_id = p_payment_intent_id,
      stripe_charge_id = p_charge_id,
      confirmation_number = v_number,
      paid_at = now(),
      hold_expires_at = NULL
  WHERE id = p_registration_id
  RETURNING * INTO v_order;

  PERFORM set_config('pre_registration.fulfilling_order', p_registration_id::text, true);
  INSERT INTO registration_snapshots (registration_id, snapshot_data)
  VALUES (p_registration_id, jsonb_build_object(
    'snapshot_version', 1,
    'order', jsonb_build_object(
      'id', v_order.id, 'household_id', v_order.household_id, 'feis_listing_id', v_order.feis_listing_id,
      'total_cents', v_order.total_cents, 'application_fee_cents', v_order.application_fee_cents,
      'event_fee_cents', v_order.event_fee_cents, 'is_late', v_order.is_late, 'created_at', v_order.created_at),
    'purchase', v_order.purchase_snapshot,
    'payment', jsonb_build_object(
      'confirmation_number', v_number, 'paid_at', v_order.paid_at,
      'checkout_session_id', v_order.stripe_checkout_session_id, 'payment_intent_id', p_payment_intent_id,
      'charge_id', p_charge_id, 'amount_cents', p_amount_cents, 'currency', p_currency,
      'account', v_order.checkout_config ->> 'account')));
  PERFORM set_config('pre_registration.fulfilling_order', '', true);

  -- Numbers go out in payment order, one feis at a time
  PERFORM 1 FROM feis_listings WHERE id = v_order.feis_listing_id FOR UPDATE;
  PERFORM _assign_numbers_for_registration(p_registration_id);

  SELECT u.email INTO v_email
  FROM households h JOIN auth.users u ON u.id = h.user_id
  WHERE h.id = v_order.household_id;

  INSERT INTO notifications (kind, dedupe_key, registration_id, recipient)
  VALUES ('registration_confirmation', 'confirmation:' || p_registration_id, p_registration_id, v_email)
  ON CONFLICT (dedupe_key) DO NOTHING;

  RETURN v_number;
END;
$$;

-- ─── Confirmation ───
CREATE OR REPLACE FUNCTION confirm_order_payment(
  p_registration_id uuid, p_claim_id uuid, p_session_id text, p_account text, p_amount_cents integer,
  p_currency text, p_payment_status text, p_payment_intent_id text, p_charge_id text, p_event_id text, p_source text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_household uuid;
  v_listing uuid;
  v_order registrations%ROWTYPE;
  v_reason text;
  v_ref text;
  v_number text;
  v_constraint text;
  v_details jsonb := jsonb_build_object('source', p_source, 'claimed_registration_id', p_registration_id);
BEGIN
  IF p_payment_status IS DISTINCT FROM 'paid' THEN
    RETURN jsonb_build_object('result', 'not_paid');
  END IF;

  SELECT household_id, feis_listing_id INTO v_household, v_listing FROM registrations WHERE id = p_registration_id;
  IF NOT FOUND THEN
    v_ref := _record_payment_exception('blocking', 'order_not_found', NULL, p_claim_id, p_event_id, p_account,
      p_session_id, p_payment_intent_id, p_amount_cents, p_currency, v_details);
    RETURN jsonb_build_object('result', 'exception', 'reason', 'order_not_found', 'support_ref', v_ref);
  END IF;

  PERFORM lock_household_feis(v_household, v_listing);
  SELECT * INTO v_order FROM registrations WHERE id = p_registration_id FOR UPDATE;

  IF v_order.status = 'paid' AND v_order.stripe_checkout_session_id = p_session_id THEN
    RETURN jsonb_build_object('result', 'already_confirmed', 'confirmation_number', v_order.confirmation_number);
  END IF;

  -- Every check is against the order's own claim, never the listing's current settings
  v_reason := CASE
    WHEN v_order.checkout_claim_id IS NULL OR v_order.checkout_claim_id IS DISTINCT FROM p_claim_id THEN 'claim_mismatch'
    WHEN v_order.checkout_config ->> 'account' IS DISTINCT FROM p_account THEN 'account_mismatch'
    WHEN v_order.stripe_checkout_session_id IS NOT NULL
         AND v_order.stripe_checkout_session_id IS DISTINCT FROM p_session_id THEN 'session_mismatch'
    WHEN lower(p_currency) IS DISTINCT FROM v_order.checkout_config ->> 'currency' THEN 'currency_mismatch'
    WHEN p_amount_cents IS DISTINCT FROM v_order.total_cents THEN 'amount_mismatch'
    WHEN p_payment_intent_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM registrations WHERE stripe_payment_intent_id = p_payment_intent_id AND id <> p_registration_id)
      THEN 'payment_reused'
    WHEN v_order.status IN ('cancelled', 'paid') THEN 'order_not_payable'
    -- Active means what idx_registrations_active_unique (002) means, as in create_order (013): neither
    -- expired nor cancelled. A live database may still hold 011's confirmed orders, which count too.
    WHEN v_order.status = 'expired' AND EXISTS (
      SELECT 1 FROM registrations
      WHERE household_id = v_household AND feis_listing_id = v_listing AND id <> p_registration_id
        AND status NOT IN ('expired', 'cancelled'))
      THEN 'late_payment_conflict'
    ELSE NULL
  END;

  IF v_reason IS NOT NULL THEN
    v_ref := _record_payment_exception('blocking', v_reason, p_registration_id, p_claim_id, p_event_id, p_account,
      p_session_id, p_payment_intent_id, p_amount_cents, p_currency, v_details);
    RETURN jsonb_build_object('result', 'exception', 'reason', v_reason, 'support_ref', v_ref);
  END IF;

  BEGIN
    v_number := _fulfil_order(p_registration_id, p_session_id, p_payment_intent_id, p_charge_id,
      p_amount_cents, lower(p_currency));
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    -- Only the one-active-order rule means "a newer order got there first". Any other uniqueness
    -- failure (numbers, payment reuse) rolls the whole transaction back so Stripe retries it.
    IF v_constraint IS DISTINCT FROM 'idx_registrations_active_unique' THEN
      RAISE;
    END IF;
    v_ref := _record_payment_exception('blocking', 'late_payment_conflict', p_registration_id, p_claim_id,
      p_event_id, p_account, p_session_id, p_payment_intent_id, p_amount_cents, p_currency,
      v_details || jsonb_build_object('caught', v_constraint));
    RETURN jsonb_build_object('result', 'exception', 'reason', 'late_payment_conflict', 'support_ref', v_ref);
  END;

  -- The money went to the account bound at checkout; flag it if the feis has since switched accounts
  IF (SELECT stripe_account_id FROM feis_listings WHERE id = v_listing) IS DISTINCT FROM p_account THEN
    PERFORM _record_payment_exception('notice', 'listing_account_changed', p_registration_id, p_claim_id,
      p_event_id, p_account, p_session_id, p_payment_intent_id, p_amount_cents, p_currency, v_details);
  END IF;

  RETURN jsonb_build_object('result', 'confirmed', 'confirmation_number', v_number);
END;
$$;

-- A failed delayed payment: record it, and free the family to start again
CREATE OR REPLACE FUNCTION record_payment_failure(p_registration_id uuid, p_claim_id uuid, p_session_id text,
  p_account text, p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_order registrations%ROWTYPE;
  v_ref text;
BEGIN
  SELECT * INTO v_order FROM registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND
     OR p_claim_id IS NULL
     OR v_order.checkout_claim_id IS DISTINCT FROM p_claim_id
     OR v_order.checkout_config ->> 'account' IS DISTINCT FROM p_account
     OR (v_order.stripe_checkout_session_id IS NOT NULL
         AND v_order.stripe_checkout_session_id IS DISTINCT FROM p_session_id) THEN
    RETURN jsonb_build_object('result', 'ignored');
  END IF;

  v_ref := _record_payment_exception('blocking', 'payment_failed', p_registration_id, p_claim_id, p_event_id,
    p_account, p_session_id, NULL, NULL, NULL, '{}'::jsonb);
  IF v_order.status IN ('draft', 'pending_payment') THEN
    UPDATE registrations SET status = 'expired' WHERE id = p_registration_id;
  END IF;
  RETURN jsonb_build_object('result', 'recorded', 'support_ref', v_ref);
END;
$$;

-- What a parent may see of their own cases: a reference, a message code and whether it is resolved
CREATE OR REPLACE FUNCTION get_my_payment_reviews(p_registration_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'registration_id', e.registration_id,
      'support_ref', e.support_ref,
      'message_code', CASE WHEN e.reason = 'payment_failed' THEN 'B' ELSE 'A' END,
      'created_at', e.created_at,
      'resolved', e.status = 'resolved'
    ) ORDER BY e.created_at DESC), '[]'::jsonb)
  FROM payment_exceptions e
  JOIN registrations r ON r.id = e.registration_id
  WHERE r.household_id = (SELECT h.id FROM households h WHERE h.user_id = auth.uid())
    AND (p_registration_id IS NULL OR e.registration_id = p_registration_id)
    AND e.reason IN ('amount_mismatch', 'currency_mismatch', 'late_payment_conflict', 'order_not_payable', 'payment_failed')
$$;

REVOKE ALL ON FUNCTION _random_code(integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION new_confirmation_number(timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION new_support_ref() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION _record_payment_exception(text, text, uuid, uuid, text, text, text, text, integer, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION _fulfil_order(uuid, text, text, text, integer, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION confirm_order_payment(uuid, uuid, text, text, integer, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_payment_failure(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_my_payment_reviews(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION confirm_order_payment(uuid, uuid, text, text, integer, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION record_payment_failure(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION get_my_payment_reviews(uuid) TO authenticated;
