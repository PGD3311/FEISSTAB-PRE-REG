-- 013_create_order.sql
-- Payment hardening, part 2: an order, its entries, consent and frozen details are created
-- in one transaction, or not at all. Spec §1, §4.

SET search_path TO pre_registration, public;

-- Serialises everything that can create or revive an active order for one family at one feis
CREATE OR REPLACE FUNCTION lock_household_feis(p_household_id uuid, p_feis_listing_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = pre_registration, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_household_id::text || ':' || p_feis_listing_id::text, 0));
END;
$$;

REVOKE ALL ON FUNCTION lock_household_feis(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION create_order(p_household_id uuid, p_feis_listing_id uuid, p_order jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_listing feis_listings%ROWTYPE;
  v_row registrations%ROWTYPE;
  v_close timestamptz;
  v_existing uuid;
  v_id uuid := gen_random_uuid();
  v_hold timestamptz := now() + interval '30 minutes';
  v_snapshot jsonb := p_order -> 'purchase_snapshot';
  v_breakdown jsonb := p_order -> 'purchase_snapshot' -> 'pricing' -> 'breakdown';
  v_mismatches integer;
  v_entry_total integer;
BEGIN
  PERFORM lock_household_feis(p_household_id, p_feis_listing_id);

  SELECT * INTO v_listing FROM feis_listings WHERE id = p_feis_listing_id;
  IF NOT FOUND OR v_listing.status <> 'open' THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'listing_closed');
  END IF;
  v_close := coalesce(v_listing.late_reg_closes_at, v_listing.reg_closes_at);
  IF (v_listing.reg_opens_at IS NOT NULL AND now() < v_listing.reg_opens_at)
     OR (v_close IS NOT NULL AND now() > v_close) THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'outside_window');
  END IF;

  -- A family whose hold has just run out is not blocked by it until the expiry job next runs:
  -- this household's unpaid orders for this feis expire here, by the same rule as that job.
  UPDATE registrations
  SET status = 'expired', updated_at = now()
  WHERE household_id = p_household_id AND feis_listing_id = p_feis_listing_id
    AND status IN ('draft', 'pending_payment') AND hold_expires_at < now();

  -- Active means what idx_registrations_active_unique (002) means: neither expired nor cancelled. A live
  -- database still holding 011's confirmed orders then refuses here, not with a unique-index error.
  SELECT id INTO v_existing FROM registrations
  WHERE household_id = p_household_id AND feis_listing_id = p_feis_listing_id
    AND status NOT IN ('expired', 'cancelled')
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'active_order_exists', 'registration_id', v_existing);
  END IF;

  -- Migration 012 lets an order and its entries in only while this marker names that order, and only
  -- in the transaction that created it, so created_at is left to its default (now()). The order starts
  -- as a draft with a 30-minute hold and no checkout or payment details, and the consent time is
  -- stamped here: the payload carries none.
  PERFORM set_config('pre_registration.creating_order', v_id::text, true);

  INSERT INTO registrations (id, feis_listing_id, household_id, status, total_cents, application_fee_cents,
    event_fee_cents, is_late, consent_accepted_at, consent_version, platform_terms_version, consent_ip,
    hold_expires_at, purchase_snapshot)
  VALUES (v_id, p_feis_listing_id, p_household_id, 'draft',
    (p_order ->> 'total_cents')::integer, (p_order ->> 'application_fee_cents')::integer,
    (p_order ->> 'event_fee_cents')::integer, (p_order ->> 'is_late')::boolean,
    now(), p_order ->> 'consent_version', p_order ->> 'platform_terms_version', p_order ->> 'consent_ip',
    v_hold, v_snapshot);

  INSERT INTO registration_entries (registration_id, dancer_id, feis_competition_id, fee_category,
    base_fee_cents, late_fee_cents, day_of_surcharge_cents)
  SELECT v_id, e.dancer_id, e.feis_competition_id, e.fee_category,
         e.base_fee_cents, e.late_fee_cents, e.day_of_surcharge_cents
  FROM jsonb_to_recordset(p_order -> 'entries') AS e(dancer_id uuid, feis_competition_id uuid, fee_category text,
    base_fee_cents integer, late_fee_cents integer, day_of_surcharge_cents integer);

  PERFORM set_config('pre_registration.creating_order', '', true);

  IF NOT EXISTS (SELECT 1 FROM registration_entries WHERE registration_id = v_id) THEN
    RAISE EXCEPTION 'an order needs at least one entry';
  END IF;

  -- The entries must be exactly the snapshot's entries, fee category and fee for fee
  WITH stored AS (
    SELECT dancer_id, feis_competition_id AS competition_id, fee_category,
      base_fee_cents, late_fee_cents, day_of_surcharge_cents
    FROM registration_entries WHERE registration_id = v_id
  ), frozen AS (
    SELECT s.dancer_id, s.competition_id, s.fee_category,
      s.base_fee_cents, s.late_fee_cents, s.day_of_surcharge_cents
    FROM jsonb_to_recordset(v_snapshot -> 'entries') AS s(dancer_id uuid, competition_id uuid, fee_category text,
      base_fee_cents integer, late_fee_cents integer, day_of_surcharge_cents integer)
  )
  SELECT count(*) INTO v_mismatches FROM (
    (SELECT * FROM stored EXCEPT ALL SELECT * FROM frozen)
    UNION ALL
    (SELECT * FROM frozen EXCEPT ALL SELECT * FROM stored)
  ) AS diff;
  IF v_mismatches > 0 THEN
    RAISE EXCEPTION 'order entries do not match the purchase snapshot';
  END IF;

  -- The totals must be the snapshot's priced totals
  SELECT coalesce(sum(base_fee_cents + late_fee_cents + day_of_surcharge_cents), 0)::integer INTO v_entry_total
  FROM registration_entries WHERE registration_id = v_id;
  IF (p_order ->> 'total_cents')::integer IS DISTINCT FROM (v_breakdown ->> 'grand_total_cents')::integer
     OR (p_order ->> 'event_fee_cents')::integer IS DISTINCT FROM (v_breakdown ->> 'event_fee_cents')::integer
     OR (v_entry_total + (v_breakdown ->> 'event_fee_cents')::integer
         - (v_breakdown ->> 'family_cap_savings_cents')::integer)
        IS DISTINCT FROM (p_order ->> 'total_cents')::integer THEN
    RAISE EXCEPTION 'order totals do not match the purchase snapshot';
  END IF;

  -- The order row's late flag and agreement are the ones the snapshot froze
  SELECT * INTO v_row FROM registrations WHERE id = v_id;
  IF v_row.is_late IS DISTINCT FROM ((v_breakdown ->> 'active_late_tier') IS NOT NULL) THEN
    RAISE EXCEPTION 'order late flag does not match the purchase snapshot';
  END IF;
  IF v_row.consent_version IS DISTINCT FROM (v_snapshot -> 'rules' ->> 'consent_version')
     OR v_row.platform_terms_version IS DISTINCT FROM (v_snapshot -> 'rules' ->> 'platform_terms_version') THEN
    RAISE EXCEPTION 'order consent or terms version does not match the purchase snapshot';
  END IF;

  -- Every dancer is this family's and active; every competition is this feis's and enabled
  IF EXISTS (
    SELECT 1 FROM registration_entries e
    LEFT JOIN dancers d
      ON d.id = e.dancer_id AND d.household_id = p_household_id AND d.is_active
    LEFT JOIN feis_competitions c
      ON c.id = e.feis_competition_id AND c.feis_listing_id = p_feis_listing_id AND c.enabled
    WHERE e.registration_id = v_id AND (d.id IS NULL OR c.id IS NULL)
  ) THEN
    RAISE EXCEPTION 'order entries name a dancer or competition that is not available';
  END IF;

  RETURN jsonb_build_object('status', 'created', 'registration_id', v_id, 'hold_expires_at', v_hold);
END;
$$;

REVOKE ALL ON FUNCTION create_order(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_order(uuid, uuid, jsonb) TO service_role;

-- Everything Pay, Cancel and the confirmation sync need to decide what to do with an order
CREATE OR REPLACE FUNCTION get_order_for_checkout(p_registration_id uuid, p_household_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pre_registration, pg_temp
AS $$
  SELECT jsonb_build_object(
    'id', r.id,
    'household_id', r.household_id,
    'feis_listing_id', r.feis_listing_id,
    'status', r.status,
    'total_cents', r.total_cents,
    'application_fee_cents', r.application_fee_cents,
    'event_fee_cents', r.event_fee_cents,
    'hold_expires_at', r.hold_expires_at,
    'confirmation_number', r.confirmation_number,
    'checkout_claim_id', r.checkout_claim_id,
    'checkout_config', r.checkout_config,
    'checkout_claimed_at', r.checkout_claimed_at,
    'checkout_expires_at', r.checkout_expires_at,
    'stripe_checkout_session_id', r.stripe_checkout_session_id,
    'purchase_snapshot', r.purchase_snapshot,
    'listing', jsonb_build_object('status', l.status, 'stripe_account_id', l.stripe_account_id),
    'competition_ids', coalesce(
      (SELECT jsonb_agg(DISTINCT e.feis_competition_id) FROM registration_entries e WHERE e.registration_id = r.id),
      '[]'::jsonb),
    'enabled_competition_ids', coalesce(
      (SELECT jsonb_agg(c.id) FROM feis_competitions c WHERE c.feis_listing_id = r.feis_listing_id AND c.enabled),
      '[]'::jsonb)
  )
  FROM registrations r
  JOIN feis_listings l ON l.id = r.feis_listing_id
  WHERE r.id = p_registration_id AND r.household_id = p_household_id
$$;

REVOKE ALL ON FUNCTION get_order_for_checkout(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_order_for_checkout(uuid, uuid) TO service_role;
