-- 014_checkout_claims.sql
-- Payment hardening, part 3: one checkout claim per order, with the whole Stripe request frozen,
-- and changes that only succeed for the exact claim they name. Spec §5, §6, §7, §13.

SET search_path TO pre_registration, public;

CREATE OR REPLACE FUNCTION claim_checkout(p_registration_id uuid, p_household_id uuid, p_claim_id uuid, p_config jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_order registrations%ROWTYPE;
  v_listing feis_listings%ROWTYPE;
  v_expires timestamptz;
  v_line_total numeric;
  v_line_count integer;
  v_bad_lines integer;
BEGIN
  SELECT * INTO v_order FROM registrations
  WHERE id = p_registration_id AND household_id = p_household_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  -- One claim per order: a second request adopts the first, never replaces it
  IF v_order.checkout_claim_id IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'already_claimed', 'status', v_order.status,
      'claim_id', v_order.checkout_claim_id, 'config', v_order.checkout_config,
      'claimed_at', v_order.checkout_claimed_at, 'session_id', v_order.stripe_checkout_session_id);
  END IF;

  IF v_order.status <> 'draft' OR v_order.hold_expires_at IS NULL OR v_order.hold_expires_at <= now() THEN
    RETURN jsonb_build_object('result', 'not_claimable', 'status', v_order.status,
      'hold_expired', v_order.hold_expires_at IS NOT NULL AND v_order.hold_expires_at <= now());
  END IF;

  -- The organiser can stop new checkouts until this moment. A successful claim is the boundary:
  -- after it, this attempt may finish even if registration closes (spec §5).
  SELECT * INTO v_listing FROM feis_listings WHERE id = v_order.feis_listing_id FOR SHARE;
  IF v_listing.status <> 'open' THEN
    RETURN jsonb_build_object('result', 'blocked', 'reason', 'organiser_stopped');
  END IF;
  IF EXISTS (
    SELECT 1 FROM registration_entries e
    JOIN feis_competitions c ON c.id = e.feis_competition_id
    WHERE e.registration_id = p_registration_id AND NOT c.enabled
  ) THEN
    RETURN jsonb_build_object('result', 'blocked', 'reason', 'competition_unavailable');
  END IF;
  IF v_listing.stripe_account_id IS NULL THEN
    RETURN jsonb_build_object('result', 'blocked', 'reason', 'stripe_not_connected');
  END IF;
  IF v_order.total_cents < 50 THEN
    RETURN jsonb_build_object('result', 'blocked', 'reason', 'amount_too_small');
  END IF;

  -- The frozen request must describe this order exactly, on the feis's current Stripe account, for
  -- cards only (Decision 3). A claim with no id or no expiry is refused here: 012 only takes a claim
  -- whose id, config, claim time and expiry all arrive together, and an unpaid order must keep a hold.
  v_expires := to_timestamp((p_config ->> 'expires_at')::bigint);
  -- Stripe takes 1 to 100 lines, each a whole, positive number of cents. A line whose amount is
  -- missing or isn't a JSON number counts as bad, rather than dropping out of the sum.
  SELECT count(*)::integer,
         count(*) FILTER (WHERE amount IS NULL OR amount <= 0 OR amount <> trunc(amount))::integer,
         coalesce(sum(amount), -1)
  INTO v_line_count, v_bad_lines, v_line_total
  FROM (
    SELECT CASE WHEN jsonb_typeof(item -> 'amount_cents') = 'number'
                THEN (item ->> 'amount_cents')::numeric END AS amount
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_config -> 'line_items') = 'array'
                                   THEN p_config -> 'line_items' ELSE '[]'::jsonb END) AS item
  ) AS lines;
  IF p_claim_id IS NULL
     OR v_expires IS NULL
     OR p_config ->> 'account' IS DISTINCT FROM v_listing.stripe_account_id
     OR p_config ->> 'currency' IS DISTINCT FROM 'usd'
     OR (p_config ->> 'total_cents')::integer IS DISTINCT FROM v_order.total_cents
     OR v_line_total IS DISTINCT FROM v_order.total_cents
     OR (p_config ->> 'application_fee_cents')::integer IS DISTINCT FROM v_order.application_fee_cents
     OR p_config -> 'metadata' ->> 'registration_id' IS DISTINCT FROM p_registration_id::text
     OR p_config -> 'metadata' ->> 'claim_id' IS DISTINCT FROM p_claim_id::text
     OR p_config ->> 'idempotency_key' IS DISTINCT FROM ('checkout:' || p_registration_id::text || ':' || p_claim_id::text)
     OR v_line_count NOT BETWEEN 1 AND 100
     OR v_bad_lines > 0
     OR p_config -> 'payment_method_types' IS DISTINCT FROM '["card"]'::jsonb
     OR v_expires < now() + interval '50 minutes'
     OR v_expires > now() + interval '70 minutes' THEN
    RAISE EXCEPTION 'checkout configuration does not match order %', p_registration_id;
  END IF;

  UPDATE registrations
  SET checkout_claim_id = p_claim_id,
      checkout_config = p_config,
      checkout_claimed_at = now(),
      checkout_expires_at = v_expires,
      hold_expires_at = v_expires + interval '15 minutes'
  WHERE id = p_registration_id;

  RETURN jsonb_build_object('result', 'claimed', 'status', 'draft', 'claim_id', p_claim_id,
    'config', p_config, 'claimed_at', now(), 'session_id', NULL);
END;
$$;

CREATE OR REPLACE FUNCTION attach_checkout_session(p_registration_id uuid, p_claim_id uuid, p_session_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_order registrations%ROWTYPE;
BEGIN
  -- Pay always names its claim and the session that claim made. Refuse anything less here, rather than
  -- leave it to 012 (a session needs a claim, and an order awaiting payment needs both)
  IF p_claim_id IS NULL OR p_session_id IS NULL THEN
    RAISE EXCEPTION 'attach_checkout_session needs the claim id and the session id';
  END IF;

  SELECT * INTO v_order FROM registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;
  IF v_order.checkout_claim_id IS DISTINCT FROM p_claim_id THEN
    RETURN jsonb_build_object('result', 'claim_mismatch', 'status', v_order.status);
  END IF;
  IF v_order.stripe_checkout_session_id = p_session_id THEN
    RETURN jsonb_build_object('result', 'already_attached', 'status', v_order.status);
  END IF;
  IF v_order.status <> 'draft' OR v_order.stripe_checkout_session_id IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'not_attachable', 'status', v_order.status,
      'session_id', v_order.stripe_checkout_session_id);
  END IF;

  UPDATE registrations
  SET status = 'pending_payment', stripe_checkout_session_id = p_session_id
  WHERE id = p_registration_id;
  RETURN jsonb_build_object('result', 'attached', 'status', 'pending_payment');
END;
$$;

-- With no expected claim, only an unclaimed draft can be cancelled. With a claim, the caller has
-- already settled that claim's Stripe session (spec §6a): closed and verified, or established
-- never to have been made.
CREATE OR REPLACE FUNCTION cancel_order(p_registration_id uuid, p_household_id uuid, p_expected_claim_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_order registrations%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM registrations
  WHERE id = p_registration_id AND household_id = p_household_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;
  IF v_order.status NOT IN ('draft', 'pending_payment')
     OR v_order.checkout_claim_id IS DISTINCT FROM p_expected_claim_id THEN
    RETURN jsonb_build_object('result', 'not_cancellable', 'status', v_order.status,
      'claim_id', v_order.checkout_claim_id);
  END IF;

  UPDATE registrations SET status = 'cancelled' WHERE id = p_registration_id;
  RETURN jsonb_build_object('result', 'cancelled', 'status', 'cancelled');
END;
$$;

-- Stripe's checkout.session.expired, or Pay finding the session expired: only the order's own
-- claim, account and session, and only while it is unpaid.
CREATE OR REPLACE FUNCTION expire_checkout(p_registration_id uuid, p_claim_id uuid, p_session_id text, p_account text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_order registrations%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'ignored', 'why', 'not_found');
  END IF;
  IF p_claim_id IS NULL
     OR v_order.checkout_claim_id IS DISTINCT FROM p_claim_id
     OR v_order.checkout_config ->> 'account' IS DISTINCT FROM p_account
     OR (v_order.stripe_checkout_session_id IS NOT NULL
         AND v_order.stripe_checkout_session_id IS DISTINCT FROM p_session_id) THEN
    RETURN jsonb_build_object('result', 'ignored', 'why', 'mismatch', 'status', v_order.status);
  END IF;
  IF v_order.status NOT IN ('draft', 'pending_payment') THEN
    RETURN jsonb_build_object('result', 'ignored', 'why', 'not_open', 'status', v_order.status);
  END IF;

  UPDATE registrations SET status = 'expired' WHERE id = p_registration_id;
  RETURN jsonb_build_object('result', 'expired', 'status', 'expired');
END;
$$;

REVOKE ALL ON FUNCTION claim_checkout(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION attach_checkout_session(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION cancel_order(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION expire_checkout(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_checkout(uuid, uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION attach_checkout_session(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION cancel_order(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION expire_checkout(uuid, uuid, text, text) TO service_role;
