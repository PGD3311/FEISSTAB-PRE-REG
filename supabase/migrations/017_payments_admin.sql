-- 017_payments_admin.sql
-- Payment hardening, part 6: how a person resolves a payment case. There is no generic "mark paid":
-- each reason has its allowed resolutions, every action needs a note and leaves an audit row, and
-- these functions live in a schema the API can't reach. Run them from the SQL editor. Spec §11.

SET search_path TO pre_registration, public;

CREATE TABLE IF NOT EXISTS admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  support_ref text,
  registration_id uuid REFERENCES registrations(id),
  actor text NOT NULL DEFAULT session_user,
  note text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;
-- PUBLIC as well, as in 012: whatever PUBLIC holds, every role holds. The service role too: the app
-- never reads or writes the audit trail, so its key can't rewrite or erase it
REVOKE ALL ON admin_actions FROM PUBLIC, anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS payments_admin;
REVOKE ALL ON SCHEMA payments_admin FROM PUBLIC;
REVOKE ALL ON SCHEMA payments_admin FROM anon, authenticated, service_role;

-- A late payment that conflicts with a newer order: confirm it only if the recorded payment passes
-- every confirmation check, no other order for the family and feis can have a payment on the way,
-- and the payment isn't already on another order. Cancels the newer unpaid order and fulfils the late
-- one, atomically, and closes the case as confirmed_late_payment in the same transaction.
CREATE OR REPLACE FUNCTION payments_admin.confirm_late_payment(p_support_ref text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_household uuid;
  v_listing uuid;
  v_case payment_exceptions%ROWTYPE;
  v_order registrations%ROWTYPE;
  v_other registrations%ROWTYPE;
  v_cancelled uuid[] := '{}';
  v_number text;
BEGIN
  -- A note must say something: blank, or only spaces, tabs or newlines, is refused
  IF p_note IS NULL OR p_note !~ '\S' THEN
    RAISE EXCEPTION 'a note explaining the decision is required';
  END IF;

  SELECT household_id, feis_listing_id INTO v_household, v_listing
  FROM payment_exceptions WHERE support_ref = p_support_ref;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no payment case %', p_support_ref;
  END IF;
  PERFORM lock_household_feis(v_household, v_listing);

  SELECT * INTO v_case FROM payment_exceptions WHERE support_ref = p_support_ref FOR UPDATE;
  IF v_case.status <> 'open' THEN
    RAISE EXCEPTION 'case % is already resolved', p_support_ref;
  END IF;
  IF v_case.reason <> 'late_payment_conflict' THEN
    RAISE EXCEPTION 'case % is %, which is resolved by a refund, not a confirmation', p_support_ref, v_case.reason;
  END IF;

  SELECT * INTO v_order FROM registrations WHERE id = v_case.registration_id FOR UPDATE;
  IF v_order.status <> 'expired' THEN
    RAISE EXCEPTION 'order % is %, not expired', v_order.id, v_order.status;
  END IF;
  IF v_order.checkout_claim_id IS DISTINCT FROM v_case.claim_id
     OR v_order.checkout_config ->> 'account' IS DISTINCT FROM v_case.stripe_account_id
     OR (v_order.stripe_checkout_session_id IS NOT NULL
         AND v_order.stripe_checkout_session_id IS DISTINCT FROM v_case.stripe_checkout_session_id)
     OR v_case.currency IS DISTINCT FROM v_order.checkout_config ->> 'currency'
     OR v_case.amount_cents IS DISTINCT FROM v_order.total_cents
     OR v_case.stripe_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'the recorded payment does not match order %', v_order.id;
  END IF;
  IF EXISTS (SELECT 1 FROM registrations WHERE stripe_payment_intent_id = v_case.stripe_payment_intent_id) THEN
    RAISE EXCEPTION 'payment % is already recorded on an order', v_case.stripe_payment_intent_id;
  END IF;

  -- Another order may only be replaced when no payment for it can exist. An order that never had a
  -- checkout claim can't have been paid; one cancelled through Cancel had its checkout settled first.
  -- Anything else that reached checkout, even if it has since expired, could still have a delayed
  -- payment on the way, so the case is resolved by refund instead (spec §11).
  FOR v_other IN
    SELECT * FROM registrations
    WHERE household_id = v_order.household_id AND feis_listing_id = v_order.feis_listing_id
      AND id <> v_order.id
    ORDER BY id
    FOR UPDATE
  LOOP
    IF v_other.status = 'paid' THEN
      RAISE EXCEPTION 'the family also paid order %; refund one payment instead', v_other.id;
    END IF;
    IF v_other.checkout_claim_id IS NOT NULL AND v_other.status <> 'cancelled' THEN
      RAISE EXCEPTION 'order % was taken to checkout, so a payment for it may still arrive; refund the late payment instead',
        v_other.id;
    END IF;
    IF v_other.status = 'draft' THEN
      UPDATE registrations SET status = 'cancelled' WHERE id = v_other.id;
      v_cancelled := v_cancelled || v_other.id;
    END IF;
  END LOOP;

  v_number := _fulfil_order(v_order.id, v_case.stripe_checkout_session_id, v_case.stripe_payment_intent_id,
    NULL, v_case.amount_cents, v_case.currency);

  UPDATE payment_exceptions
  SET status = 'resolved', resolution = 'confirmed_late_payment', resolved_at = now(), resolved_by = session_user
  WHERE id = v_case.id;

  INSERT INTO admin_actions (action, support_ref, registration_id, note, evidence)
  VALUES ('confirm_late_payment', p_support_ref, v_order.id, p_note, jsonb_build_object(
    'payment_intent_id', v_case.stripe_payment_intent_id,
    'checkout_session_id', v_case.stripe_checkout_session_id,
    'amount_cents', v_case.amount_cents,
    'cancelled_orders', to_jsonb(v_cancelled),
    'confirmation_number', v_number));

  RETURN jsonb_build_object('result', 'confirmed', 'confirmation_number', v_number,
    'cancelled_orders', to_jsonb(v_cancelled));
END;
$$;

-- Closes a case without confirming anything. Which closings are allowed depends on the reason.
CREATE OR REPLACE FUNCTION payments_admin.close_exception(p_support_ref text, p_resolution text,
  p_stripe_refund_id text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_case payment_exceptions%ROWTYPE;
BEGIN
  -- A note must say something: blank, or only spaces, tabs or newlines, is refused
  IF p_note IS NULL OR p_note !~ '\S' THEN
    RAISE EXCEPTION 'a note explaining the decision is required';
  END IF;

  SELECT * INTO v_case FROM payment_exceptions WHERE support_ref = p_support_ref FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no payment case %', p_support_ref;
  END IF;
  IF v_case.status <> 'open' THEN
    RAISE EXCEPTION 'case % is already resolved', p_support_ref;
  END IF;

  IF p_resolution = 'refunded' THEN
    IF v_case.reason NOT IN ('amount_mismatch', 'currency_mismatch', 'order_not_payable', 'payment_reused',
                             'account_mismatch', 'claim_mismatch', 'session_mismatch', 'order_not_found',
                             'late_payment_conflict') THEN
      RAISE EXCEPTION '% cases are not closed by a refund', v_case.reason;
    END IF;
    IF p_stripe_refund_id IS NULL OR p_stripe_refund_id !~ '^(re|pyr)_[A-Za-z0-9]+$' THEN
      RAISE EXCEPTION 'a Stripe refund ID (re_...) is required';
    END IF;
  ELSIF p_resolution = 'no_action' THEN
    -- A failed payment moved no money. A reused payment is the recorded payment of another, confirmed order:
    -- refunding it would refund that order, so unless Stripe shows a genuine second charge there is nothing to refund
    IF v_case.reason NOT IN ('payment_failed', 'payment_reused') THEN
      RAISE EXCEPTION 'only failed payments, and payments already recorded on another order, close with no action';
    END IF;
  ELSIF p_resolution = 'acknowledged' THEN
    IF v_case.reason <> 'listing_account_changed' THEN
      RAISE EXCEPTION 'only account-change notices are acknowledged';
    END IF;
  ELSE
    RAISE EXCEPTION 'unknown resolution %', p_resolution;
  END IF;
  -- A refund ID belongs only on a refund: on any other closing it would claim money went back
  IF p_stripe_refund_id IS NOT NULL AND p_resolution <> 'refunded' THEN
    RAISE EXCEPTION 'a Stripe refund ID is only recorded when the resolution is refunded';
  END IF;

  UPDATE payment_exceptions
  SET status = 'resolved', resolution = p_resolution, resolved_at = now(), resolved_by = session_user,
      details = details || CASE WHEN p_stripe_refund_id IS NULL THEN '{}'::jsonb
                                ELSE jsonb_build_object('stripe_refund_id', p_stripe_refund_id) END
  WHERE id = v_case.id;

  INSERT INTO admin_actions (action, support_ref, registration_id, note, evidence)
  VALUES ('close_exception', p_support_ref, v_case.registration_id, p_note,
    jsonb_build_object('resolution', p_resolution, 'stripe_refund_id', p_stripe_refund_id));

  RETURN jsonb_build_object('result', 'resolved', 'resolution', p_resolution);
END;
$$;

-- Every API role, by name as well as through PUBLIC: run these from the SQL editor only
REVOKE ALL ON FUNCTION payments_admin.confirm_late_payment(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION payments_admin.close_exception(text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
