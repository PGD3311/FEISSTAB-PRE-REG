-- 013_create_order.sql
-- Payment hardening, part 2: an order, its entries, consent and frozen details are created
-- in one transaction, or not at all. A family may hold one unpaid order per feis and any number
-- of paid ones; each new order's price counts the paid ones (add-on orders). Spec §1, §4, §14.

SET search_path TO pre_registration, public;

-- Serialises everything that creates an order or makes one paid for one family at one feis
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

-- The family's paid orders for this feis as a later order counts them (spec §4): the record a price freezes as
-- purchase_snapshot.pricing.prior, rebuilt here from the rows so create_order can compare the two as jsonb.
-- Orders by id, each order's entries by dancer then competition, every key present, and null when the family
-- has no paid order. Whether an entry counted toward the family max is its own order's frozen flag, or for an
-- older order with no purchase snapshot, the competition's flag now.
CREATE OR REPLACE FUNCTION _counted_orders(p_household_id uuid, p_feis_listing_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pre_registration, pg_temp
AS $$
  WITH paid AS (
    SELECT r.id, r.confirmation_number, r.event_fee_cents, r.purchase_snapshot
    FROM registrations r
    WHERE r.household_id = p_household_id AND r.feis_listing_id = p_feis_listing_id AND r.status = 'paid'
  ), entries AS (
    SELECT e.registration_id, e.dancer_id, e.feis_competition_id AS competition_id,
      e.base_fee_cents, e.late_fee_cents,
      NOT coalesce(
        (SELECT (frozen ->> 'exclude_from_family_cap')::boolean
         FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.purchase_snapshot -> 'competitions') = 'array'
                                        THEN p.purchase_snapshot -> 'competitions' ELSE '[]'::jsonb END) AS frozen
         WHERE frozen ->> 'id' = e.feis_competition_id::text
         LIMIT 1),
        c.exclude_from_family_cap,
        false) AS counts_toward_family_cap
    FROM paid p
    JOIN registration_entries e ON e.registration_id = p.id
    LEFT JOIN feis_competitions c ON c.id = e.feis_competition_id
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM paid) THEN NULL ELSE jsonb_build_object(
    'orders', (
      SELECT jsonb_agg(jsonb_build_object(
          'id', p.id,
          'confirmation_number', p.confirmation_number,
          'event_fee_cents', p.event_fee_cents,
          'entries', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'dancer_id', x.dancer_id,
                'competition_id', x.competition_id,
                'base_fee_cents', x.base_fee_cents,
                'late_fee_cents', x.late_fee_cents,
                'counts_toward_family_cap', x.counts_toward_family_cap)
              ORDER BY x.dancer_id, x.competition_id)
            FROM entries x WHERE x.registration_id = p.id), '[]'::jsonb))
        ORDER BY p.id)
      FROM paid p),
    'event_fee_paid', EXISTS (SELECT 1 FROM paid WHERE event_fee_cents > 0),
    'cappable_paid_cents',
      (SELECT coalesce(sum(base_fee_cents) FILTER (WHERE counts_toward_family_cap), 0) FROM entries),
    'late_fee_dancer_ids', coalesce(
      (SELECT jsonb_agg(d.dancer_id ORDER BY d.dancer_id)
       FROM (SELECT DISTINCT dancer_id FROM entries WHERE late_fee_cents > 0) AS d),
      '[]'::jsonb),
    'late_fees_paid_cents', (SELECT coalesce(sum(late_fee_cents), 0) FROM entries)
  ) END
$$;

REVOKE ALL ON FUNCTION _counted_orders(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

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
  v_counted jsonb;
  v_id uuid := gen_random_uuid();
  v_hold timestamptz := now() + interval '30 minutes';
  v_snapshot jsonb := p_order -> 'purchase_snapshot';
  v_breakdown jsonb := p_order -> 'purchase_snapshot' -> 'pricing' -> 'breakdown';
  v_schedule jsonb := p_order -> 'purchase_snapshot' -> 'pricing' -> 'fee_schedule';
  v_mismatches integer;
  v_entry_total integer;
  v_capped integer;
  v_cap integer;
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

  -- Stripe can't take a card payment of 1 to 49 cents, so no order is made that could never be paid
  -- (Decision 10). A total of 0 is allowed: Pay confirms it without Stripe (confirm_free_order, 015).
  IF (p_order ->> 'total_cents')::integer BETWEEN 1 AND 49 THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'amount_too_small');
  END IF;

  -- A family whose hold has just run out is not blocked by it until the expiry job next runs:
  -- this household's unpaid orders for this feis expire here, by the same rule as that job.
  UPDATE registrations
  SET status = 'expired', updated_at = now()
  WHERE household_id = p_household_id AND feis_listing_id = p_feis_listing_id
    AND status IN ('draft', 'pending_payment') AND hold_expires_at < now();

  -- One unpaid order at a time: in practice the draft or pending_payment order 019's index allows one of. A
  -- live database still holding 011's confirmed orders refuses here too, rather than pricing around one.
  -- Paid orders don't refuse: they're counted below.
  SELECT id INTO v_existing FROM registrations
  WHERE household_id = p_household_id AND feis_listing_id = p_feis_listing_id
    AND status NOT IN ('paid', 'expired', 'cancelled')
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'unpaid_order_exists', 'registration_id', v_existing);
  END IF;

  -- The price must have counted exactly the family's paid orders as they are now. This catches an order paid
  -- between Submit's read and here, such as a late payment, and any record built wrongly. A first order's
  -- prior is null (a missing key counts as null too).
  v_counted := _counted_orders(p_household_id, p_feis_listing_id);
  IF v_counted IS DISTINCT FROM nullif(v_snapshot -> 'pricing' -> 'prior', 'null'::jsonb) THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'paid_orders_changed');
  END IF;

  -- An add-on only adds: a dance already in one of the family's paid orders is never bought twice
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_order -> 'entries') AS e(dancer_id uuid, feis_competition_id uuid)
    JOIN registration_entries pe ON pe.dancer_id = e.dancer_id AND pe.feis_competition_id = e.feis_competition_id
    JOIN registrations r ON r.id = pe.registration_id
    WHERE r.household_id = p_household_id AND r.feis_listing_id = p_feis_listing_id AND r.status = 'paid'
  ) THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'already_entered');
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

  -- The once-per-family rules hold against the counted orders. The family fee is charged once: 0 when a
  -- counted order paid it, otherwise the frozen schedule's fee
  IF (p_order ->> 'event_fee_cents')::integer IS DISTINCT FROM
     (CASE WHEN coalesce((v_counted ->> 'event_fee_paid')::boolean, false) THEN 0
           ELSE (v_schedule ->> 'event_fee_cents')::integer END) THEN
    RAISE EXCEPTION 'order event fee does not match the counted orders';
  END IF;
  -- No dancer the counted orders charged a late fee is charged one here, and no dancer more than one here
  IF EXISTS (
       SELECT 1 FROM registration_entries e
       WHERE e.registration_id = v_id AND e.late_fee_cents > 0
         AND e.dancer_id::text IN (
           SELECT jsonb_array_elements_text(coalesce(v_counted -> 'late_fee_dancer_ids', '[]'::jsonb))))
     OR EXISTS (
       SELECT 1 FROM registration_entries e
       WHERE e.registration_id = v_id AND e.late_fee_cents > 0
       GROUP BY e.dancer_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'order late fees do not match the counted orders';
  END IF;
  -- The family-max saving is what the frozen family max leaves after the counted orders. Whether this order's
  -- entries count toward it is the snapshot's flag for each competition (the late tier's own max is left to
  -- calculateFees, which is unit-tested)
  v_cap := (v_schedule ->> 'family_cap_cents')::integer;
  SELECT coalesce(sum(e.base_fee_cents), 0)::integer INTO v_capped
  FROM registration_entries e
  LEFT JOIN feis_competitions c ON c.id = e.feis_competition_id
  WHERE e.registration_id = v_id
    AND NOT coalesce(
      (SELECT (frozen ->> 'exclude_from_family_cap')::boolean
       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_snapshot -> 'competitions') = 'array'
                                      THEN v_snapshot -> 'competitions' ELSE '[]'::jsonb END) AS frozen
       WHERE frozen ->> 'id' = e.feis_competition_id::text
       LIMIT 1),
      c.exclude_from_family_cap,
      false);
  IF (v_breakdown ->> 'family_cap_savings_cents')::integer IS DISTINCT FROM
     (CASE WHEN v_cap IS NULL THEN 0
           ELSE greatest(0, v_capped - greatest(0, v_cap - coalesce((v_counted ->> 'cappable_paid_cents')::integer, 0)))
      END) THEN
    RAISE EXCEPTION 'order family max saving does not match the counted orders';
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
