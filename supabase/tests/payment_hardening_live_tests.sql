-- payment_hardening_live_tests.sql
-- Live tests for migrations 012–017 and 020, with throwaway test identities: what parents, anon and
-- organisers can do, and the privileges, row-level security and guards that make it so; then add-on
-- orders and $0 orders through the real order functions (spec, Live verification).
-- Run the whole file as ONE transaction (Supabase MCP apply_migration, or the SQL editor). The last
-- statement always raises, so nothing is kept (and apply_migration records nothing). Read the result
-- from the error: "PAYMENT HARDENING LIVE TESTS: <passed>/<total> passed; FAILED: ...".

CREATE TEMP TABLE t_results (n serial, name text, ok boolean, detail text) ON COMMIT DROP;
GRANT ALL ON t_results TO PUBLIC;
GRANT USAGE ON SEQUENCE t_results_n_seq TO PUBLIC;
CREATE TEMP TABLE t_ids (k text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT SELECT ON t_ids TO PUBLIC;

CREATE FUNCTION pg_temp.id(p_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM t_ids WHERE k = p_k $$;
CREATE FUNCTION pg_temp.as_user(p_k text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', (SELECT id FROM t_ids WHERE k = p_k), 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE FUNCTION pg_temp.as_anon() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  PERFORM set_config('role', 'anon', true);
END $$;
CREATE FUNCTION pg_temp.as_service() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END $$;
CREATE FUNCTION pg_temp.as_admin() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claims', '', true);
END $$;
CREATE FUNCTION pg_temp.ok(p_name text, p_ok boolean, p_detail text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO t_results (name, ok, detail) VALUES (p_name, COALESCE(p_ok, false), p_detail)
$$;

-- A one-dance create_order payload at the test feis: no family fee, a $15.00 family max, and the given dance fee
-- and family-max saving, counting `p_prior` (what _counted_orders returns; null for a first order). create_order
-- checks it against the snapshot exactly as it checks Submit's.
-- application_fee_cents is a stand-in (5%): create_order stores the fee as given and checks nothing about its
-- value, so neither it nor these tests depend on RunFeis's flat $6.
CREATE FUNCTION pg_temp.payload(p_dancer uuid, p_comp uuid, p_fee integer, p_saving integer, p_prior jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'total_cents', p_fee - p_saving, 'application_fee_cents', round((p_fee - p_saving) * 0.05)::integer,
    'event_fee_cents', 0, 'is_late', false,
    'consent_ip', '203.0.113.7', 'consent_version', 'live-test', 'platform_terms_version', 'live-test',
    'entries', jsonb_build_array(e.entry || jsonb_build_object('feis_competition_id', p_comp)),
    'purchase_snapshot', jsonb_build_object(
      'version', 1,
      -- create_order checks the order's consent and terms versions against the snapshot's rules
      'rules', jsonb_build_object('consent_version', 'live-test', 'platform_terms_version', 'live-test'),
      'entries', jsonb_build_array(e.entry || jsonb_build_object('competition_id', p_comp)),
      'competitions', jsonb_build_array(jsonb_build_object('id', c.id, 'exclude_from_family_cap', c.exclude_from_family_cap)),
      'pricing', jsonb_build_object(
        'fee_schedule', jsonb_build_object('event_fee_cents', 0, 'family_cap_cents', 1500),
        'breakdown', jsonb_build_object('grand_total_cents', p_fee - p_saving, 'event_fee_cents', 0,
                                        'family_cap_savings_cents', p_saving),
        'prior', p_prior)))
  FROM pre_registration.feis_competitions c
  CROSS JOIN LATERAL (SELECT jsonb_build_object('dancer_id', p_dancer, 'fee_category', 'solo', 'base_fee_cents', p_fee,
                        'late_fee_cents', 0, 'day_of_surcharge_cents', 0) AS entry) AS e
  WHERE c.id = p_comp
$$;
-- What the test family's paid orders for the test feis count for its next order, as create_order rebuilds it
CREATE FUNCTION pg_temp.counted() RETURNS jsonb LANGUAGE sql AS $$
  SELECT pre_registration._counted_orders(pg_temp.id('household'), pg_temp.id('feis'))
$$;
-- Takes an order to checkout as Pay does: claim_checkout with a frozen request, then attach_checkout_session
CREATE FUNCTION pg_temp.to_checkout(p_order uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_order pre_registration.registrations%ROWTYPE;
  v_claim uuid := gen_random_uuid();
  v_session text := 'cs_live_test_' || replace(gen_random_uuid()::text, '-', '');
  v_account text;
  v_result jsonb;
BEGIN
  SELECT * INTO v_order FROM pre_registration.registrations WHERE id = p_order;
  SELECT stripe_account_id INTO v_account FROM pre_registration.feis_listings WHERE id = v_order.feis_listing_id;
  v_result := pre_registration.claim_checkout(p_order, v_order.household_id, v_claim, jsonb_build_object(
    'account', v_account, 'currency', 'usd', 'total_cents', v_order.total_cents,
    'application_fee_cents', v_order.application_fee_cents,
    'line_items', jsonb_build_array(jsonb_build_object('name', 'Live test entries', 'amount_cents', v_order.total_cents,
                                                       'quantity', 1)),
    'metadata', jsonb_build_object('registration_id', p_order, 'claim_id', v_claim),
    'idempotency_key', 'checkout:' || p_order || ':' || v_claim,
    'payment_method_types', jsonb_build_array('card'),
    'expires_at', extract(epoch FROM now() + interval '60 minutes')::bigint));
  IF v_result ->> 'result' IS DISTINCT FROM 'claimed' THEN
    RAISE EXCEPTION 'claim_checkout did not claim order %: %', p_order, v_result;
  END IF;
  PERFORM pre_registration.attach_checkout_session(p_order, v_claim, v_session);
  RETURN jsonb_build_object('claim_id', v_claim, 'session_id', v_session, 'account', v_account);
END $$;
-- The payment for a checkout, as the webhook reports it
CREATE FUNCTION pg_temp.pay(p_order uuid, p_checkout jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pre_registration.confirm_order_payment(p_order, (p_checkout ->> 'claim_id')::uuid, p_checkout ->> 'session_id',
    p_checkout ->> 'account', (SELECT total_cents FROM pre_registration.registrations WHERE id = p_order), 'usd', 'paid',
    'pi_' || (p_checkout ->> 'session_id'), NULL, 'evt_live_test', 'webhook')
$$;
-- Stripe's expiry of a checkout, so a payment for it arrives late
CREATE FUNCTION pg_temp.expire(p_order uuid, p_checkout jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pre_registration.expire_checkout(p_order, (p_checkout ->> 'claim_id')::uuid, p_checkout ->> 'session_id',
    p_checkout ->> 'account')
$$;

-- ---------- Fixtures (as admin): two families, one test feis, one order made by create_order ----------
-- The test feis has a $15.00 family max and three dances: Test Reel and Test Slip Jig at $15.00, and Test
-- Special at $10.00, outside the family max. The parent has two dancers.
DO $$
DECLARE
  v_household uuid;
  v_listing uuid;
  v_comp uuid;
  v_comp2 uuid;
  v_special uuid;
  v_dancer uuid;
  v_dancer2 uuid;
  v_result jsonb;
BEGIN
  INSERT INTO t_ids VALUES ('parent', gen_random_uuid()), ('stranger', gen_random_uuid()), ('organiser', gen_random_uuid());
  INSERT INTO auth.users (id, email, aud, role)
  SELECT id, k || '-' || substr(id::text, 1, 8) || '@payment-hardening.test', 'authenticated', 'authenticated' FROM t_ids;

  INSERT INTO pre_registration.households (user_id, first_name, last_name, phone, address_line1, city, state_region, postal_code)
  VALUES (pg_temp.id('parent'), 'Test', 'Parent', '555-0100', '1 Test Rd', 'Boston', 'MA', '02101')
  RETURNING id INTO v_household;
  INSERT INTO pre_registration.households (user_id, first_name, last_name, phone, address_line1, city, state_region, postal_code)
  VALUES (pg_temp.id('stranger'), 'Other', 'Family', '555-0101', '2 Test Rd', 'Boston', 'MA', '02101');

  INSERT INTO pre_registration.feis_listings (name, status, reg_opens_at, reg_closes_at, created_by, stripe_account_id)
  VALUES ('Payment Hardening Test Feis', 'open', now() - interval '1 day', now() + interval '1 day',
          pg_temp.id('organiser'), 'acct_live_test')
  RETURNING id INTO v_listing;
  INSERT INTO pre_registration.feis_competitions (feis_listing_id, competition_type, fee_category, display_name, enabled,
    dance_key)
  VALUES (v_listing, 'solo', 'solo', 'Test Reel', true, 'reel')
  RETURNING id INTO v_comp;
  INSERT INTO pre_registration.feis_competitions (feis_listing_id, competition_type, fee_category, display_name, enabled,
    dance_key)
  VALUES (v_listing, 'solo', 'solo', 'Test Slip Jig', true, 'slip_jig')
  RETURNING id INTO v_comp2;
  INSERT INTO pre_registration.feis_competitions (feis_listing_id, competition_type, fee_category, display_name, enabled,
    fee_cents, exclude_from_family_cap)
  VALUES (v_listing, 'special', 'solo', 'Test Special', true, 1000, true)
  RETURNING id INTO v_special;
  INSERT INTO pre_registration.dancers (household_id, first_name, last_name, date_of_birth, gender)
  VALUES (v_household, 'Test', 'Dancer', '2016-01-01', 'female')
  RETURNING id INTO v_dancer;
  INSERT INTO pre_registration.dancers (household_id, first_name, last_name, date_of_birth, gender)
  VALUES (v_household, 'Second', 'Dancer', '2017-01-01', 'female')
  RETURNING id INTO v_dancer2;

  -- The family's first order: Test Reel, $15.00, which uses the whole family max
  v_result := pre_registration.create_order(v_household, v_listing, pg_temp.payload(v_dancer, v_comp, 1500, 0, NULL));
  INSERT INTO t_ids VALUES ('order', (v_result ->> 'registration_id')::uuid), ('dancer', v_dancer), ('comp', v_comp),
    ('feis', v_listing), ('household', v_household), ('comp2', v_comp2), ('special', v_special), ('dancer2', v_dancer2);
END $$;

-- ---------- Reads ----------
DO $$ DECLARE v_n int; BEGIN
  PERFORM pg_temp.as_user('parent');
  SELECT count(*) INTO v_n FROM pre_registration.registrations WHERE id = pg_temp.id('order');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('parent reads own order', v_n = 1, v_n::text);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('parent reads own order', false, SQLERRM); END $$;

DO $$ DECLARE v_n int; BEGIN
  PERFORM pg_temp.as_user('parent');
  SELECT count(*) INTO v_n FROM pre_registration.registration_entries WHERE registration_id = pg_temp.id('order');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('parent reads own entries', v_n = 1, v_n::text);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('parent reads own entries', false, SQLERRM); END $$;

DO $$ DECLARE v_n int; BEGIN
  PERFORM pg_temp.as_user('stranger');
  SELECT count(*) INTO v_n FROM pre_registration.registrations WHERE id = pg_temp.id('order');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('another family cannot see the order', v_n = 0, v_n::text);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('another family cannot see the order', false, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_anon();
  PERFORM 1 FROM pre_registration.registrations LIMIT 1;
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('anon cannot read orders', false, 'select succeeded');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('anon cannot read orders', true, SQLERRM); END $$;

-- What the organiser entries view reads (getFeisEntries): the feis's orders, and each entry with its
-- order, dancer and competition, through 012's organiser policies and 010's dancer policy
DO $$ DECLARE v_orders int; v_entries int; v_named int; v_competitions int; BEGIN
  PERFORM pg_temp.as_user('organiser');
  SELECT count(*) INTO v_orders FROM pre_registration.registrations WHERE feis_listing_id = pg_temp.id('feis');
  SELECT count(*), count(d.first_name), count(c.id) INTO v_entries, v_named, v_competitions
  FROM pre_registration.registration_entries e
  JOIN pre_registration.registrations r ON r.id = e.registration_id
  LEFT JOIN pre_registration.dancers d ON d.id = e.dancer_id
  LEFT JOIN pre_registration.feis_competitions c ON c.id = e.feis_competition_id
  WHERE r.feis_listing_id = pg_temp.id('feis') AND r.status IN ('paid', 'pending_payment', 'draft');
  PERFORM pg_temp.as_admin();
  PERFORM pg_temp.ok('the organiser reads the feis''s orders and entries, with dancer names',
    v_orders = 1 AND v_entries = 1 AND v_named = 1 AND v_competitions = 1,
    format('orders %s, entries %s, dancer names %s, competitions %s', v_orders, v_entries, v_named, v_competitions));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.ok('the organiser reads the feis''s orders and entries, with dancer names', false, SQLERRM);
END $$;

-- ---------- Refused writes ----------
DO $$ BEGIN
  PERFORM pg_temp.as_user('parent');
  UPDATE pre_registration.registrations SET status = 'paid' WHERE id = pg_temp.id('order');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('parent cannot mark an order paid', false, 'update succeeded');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('parent cannot mark an order paid', true, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('parent');
  UPDATE pre_registration.registrations SET total_cents = 1 WHERE id = pg_temp.id('order');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('parent cannot change a total', false, 'update succeeded');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('parent cannot change a total', true, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('parent');
  INSERT INTO pre_registration.registration_entries (registration_id, dancer_id, feis_competition_id, fee_category, base_fee_cents)
  VALUES (pg_temp.id('order'), pg_temp.id('dancer'), pg_temp.id('comp'), 'solo', 0);
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('parent cannot add an entry', false, 'insert succeeded');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('parent cannot add an entry', true, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('parent');
  DELETE FROM pre_registration.registration_entries WHERE registration_id = pg_temp.id('order');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('parent cannot delete entries', false, 'delete succeeded');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('parent cannot delete entries', true, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('parent');
  INSERT INTO pre_registration.registration_snapshots (registration_id, snapshot_data) VALUES (pg_temp.id('order'), '{}');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('parent cannot write a snapshot', false, 'insert succeeded');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('parent cannot write a snapshot', true, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('parent');
  PERFORM pre_registration.confirm_order_payment(pg_temp.id('order'), NULL, 'cs_x', 'acct_live_test', 1500, 'usd',
    'paid', 'pi_x', NULL, 'evt_x', 'webhook');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('parent cannot call confirm_order_payment', false, 'call succeeded');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('parent cannot call confirm_order_payment', true, SQLERRM); END $$;

-- A refusal only counts if the script really was that role: a failed switch would also raise 42501
DO $$ DECLARE v_anon text; v_service text; BEGIN
  PERFORM pg_temp.as_anon(); v_anon := current_user; PERFORM pg_temp.as_admin();
  PERFORM pg_temp.as_service(); v_service := current_user; PERFORM pg_temp.as_admin();
  PERFORM pg_temp.ok('the script can act as anon and as the service role',
    v_anon = 'anon' AND v_service = 'service_role', concat_ws(', ', v_anon, v_service));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('the script can act as anon and as the service role', false, SQLERRM); END $$;

-- payments_admin is for the SQL editor only. Each call must be refused for lack of permission (42501), not
-- reach the function and fail there ("no payment case")
DO $$ BEGIN
  PERFORM pg_temp.as_user('parent');
  PERFORM payments_admin.close_exception('PAY-XXXXX', 'no_action', NULL, 'x');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('parent cannot reach payments_admin', false, 'call succeeded');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('parent cannot reach payments_admin', SQLSTATE = '42501', SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_anon();
  PERFORM payments_admin.close_exception('PAY-XXXXX', 'no_action', NULL, 'x');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('anon cannot reach payments_admin', false, 'call succeeded');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('anon cannot reach payments_admin', SQLSTATE = '42501', SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_service();
  PERFORM payments_admin.confirm_late_payment('PAY-XXXXX', 'x');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('the service role cannot reach payments_admin', false, 'call succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.ok('the service role cannot reach payments_admin', SQLSTATE = '42501', SQLERRM);
END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_service();
  INSERT INTO pre_registration.admin_actions (action, note) VALUES ('forged', 'not a real decision');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('the service role cannot write the audit trail', false, 'insert succeeded');
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.ok('the service role cannot write the audit trail', SQLSTATE = '42501', SQLERRM);
END $$;

-- ---------- State after the attempts, and the effective rules ----------
DO $$ DECLARE v record; BEGIN
  SELECT r.status, r.total_cents,
         (SELECT count(*) FROM pre_registration.registration_entries e WHERE e.registration_id = r.id) AS entries
  INTO v FROM pre_registration.registrations r WHERE r.id = pg_temp.id('order');
  PERFORM pg_temp.ok('order unchanged after every refused write',
    v.status = 'draft' AND v.total_cents = 1500 AND v.entries = 1, row_to_json(v)::text);
END $$;

DO $$ DECLARE v_policies text; BEGIN
  SELECT string_agg(tablename || ':' || policyname || ':' || cmd, ' | '
                    ORDER BY tablename COLLATE "C", policyname COLLATE "C") INTO v_policies
  FROM pg_policies
  WHERE schemaname = 'pre_registration'
    AND tablename IN ('registrations', 'registration_entries', 'registration_snapshots');
  PERFORM pg_temp.ok('effective policies are exactly the read-only set', v_policies =
    'registration_entries:Organisers read entries for their feiseanna:SELECT | registration_entries:Parents read own entries:SELECT | '
    'registration_snapshots:Organisers read snapshots for their feiseanna:SELECT | registration_snapshots:Parents read own snapshots:SELECT | '
    'registrations:Organisers read registrations for their feiseanna:SELECT | registrations:Parents read own registrations:SELECT',
    v_policies);
END $$;

-- The table ACLs themselves, as the local suite reads them, so a privilege a newer Postgres adds (PG17
-- MAINTAIN) shows up too. REVOKE only removes the runner's own grants, so this is what really holds.
DO $$ DECLARE v_acl text; BEGIN
  SELECT string_agg(c.relname || ':' || CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
                    || ':' || a.privilege_type, ', ' ORDER BY c.relname, a.privilege_type) INTO v_acl
  FROM pg_class c
  CROSS JOIN LATERAL aclexplode(c.relacl) AS a
  WHERE c.relnamespace = 'pre_registration'::regnamespace
    AND c.relname IN ('registrations', 'registration_entries', 'registration_snapshots')
    AND (a.grantee = 0 OR a.grantee IN ('anon'::regrole, 'authenticated'::regrole));
  PERFORM pg_temp.ok('PUBLIC and anon hold nothing on the order tables, and authenticated only SELECT', v_acl =
    'registration_entries:authenticated:SELECT, registration_snapshots:authenticated:SELECT',
    v_acl);
END $$;

-- consent_ip and checkout_config are private: authenticated reads registrations column by column
DO $$ DECLARE v_private text; BEGIN
  SELECT string_agg(col, ', ') INTO v_private
  FROM unnest(ARRAY['consent_ip', 'checkout_config']) AS col
  WHERE has_column_privilege('authenticated', 'pre_registration.registrations', col, 'SELECT');
  PERFORM pg_temp.ok('authenticated cannot read consent_ip or checkout_config', v_private IS NULL, v_private);
END $$;

-- has_table_privilege misses column-level grants; has_any_column_privilege sees them
DO $$ DECLARE v_writes text; BEGIN
  SELECT string_agg(r.role || ':' || t.tbl || ':' || p.priv, ', ') INTO v_writes
  FROM unnest(ARRAY['anon', 'authenticated']) AS r(role)
  CROSS JOIN unnest(ARRAY['registrations', 'registration_entries', 'registration_snapshots']) AS t(tbl)
  CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE']) AS p(priv)
  WHERE has_any_column_privilege(r.role, 'pre_registration.' || t.tbl, p.priv);
  PERFORM pg_temp.ok('no INSERT or UPDATE on any column for anon or authenticated', v_writes IS NULL, v_writes);
END $$;

DO $$ DECLARE v_off text; BEGIN
  SELECT string_agg(relname, ', ') INTO v_off FROM pg_class
  WHERE relnamespace = 'pre_registration'::regnamespace
    AND relname IN ('registrations', 'registration_entries', 'registration_snapshots') AND NOT relrowsecurity;
  PERFORM pg_temp.ok('row-level security is on for the three order tables', v_off IS NULL, v_off);
END $$;

DO $$ DECLARE v_truncate text; BEGIN
  SELECT string_agg(t.tbl, ', ') INTO v_truncate
  FROM unnest(ARRAY['registrations', 'registration_entries', 'registration_snapshots']) AS t(tbl)
  WHERE has_table_privilege('service_role', 'pre_registration.' || t.tbl, 'TRUNCATE');
  PERFORM pg_temp.ok('the service role cannot TRUNCATE the order tables', v_truncate IS NULL, v_truncate);
END $$;

-- The row guards and the TRUNCATE guards, each on its own table and switched on
DO $$ DECLARE v_n int; BEGIN
  SELECT count(*) INTO v_n
  FROM (VALUES ('registrations', 'guard_registrations'),
               ('registration_entries', 'guard_registration_entries'),
               ('registration_snapshots', 'guard_registration_snapshots'),
               ('registrations', 'guard_registrations_truncate'),
               ('registration_entries', 'guard_registration_entries_truncate'),
               ('registration_snapshots', 'guard_registration_snapshots_truncate')) AS g(tbl, trigger_name)
  JOIN pg_trigger t ON t.tgrelid = ('pre_registration.' || g.tbl)::regclass AND t.tgname = g.trigger_name
  WHERE NOT t.tgisinternal AND t.tgenabled IN ('O', 'A');
  PERFORM pg_temp.ok('the three row guards and the three TRUNCATE guards are installed and on', v_n = 6, v_n::text);
END $$;

-- 017: no API role can use the admin schema or its functions, or holds anything on the audit table (an empty ACL
-- is read as the default one, which for a function includes EXECUTE for PUBLIC)
DO $$ DECLARE v_reach text; v_acl text; BEGIN
  SELECT string_agg(r.role || ':' || f.fn, ', ') INTO v_reach
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r(role)
  CROSS JOIN unnest(ARRAY['payments_admin.confirm_late_payment(text, text)',
                          'payments_admin.close_exception(text, text, text, text)']) AS f(fn)
  WHERE has_schema_privilege(r.role, 'payments_admin', 'USAGE') OR has_function_privilege(r.role, f.fn, 'EXECUTE');
  SELECT string_agg(CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END || ':' || a.privilege_type,
                    ', ' ORDER BY a.privilege_type) INTO v_acl
  FROM pg_class c
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) AS a
  WHERE c.oid = 'pre_registration.admin_actions'::regclass
    AND (a.grantee = 0 OR a.grantee IN ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole));
  PERFORM pg_temp.ok('no API role can run payments_admin or touch admin_actions', v_reach IS NULL AND v_acl IS NULL,
    concat_ws(' | ', v_reach, v_acl));
END $$;

-- 016's email queue is for the service role (the cron endpoint) only
DO $$ DECLARE v_callable text; BEGIN
  SELECT string_agg(r.role || ':' || f.fn, ', ') INTO v_callable
  FROM unnest(ARRAY['anon', 'authenticated']) AS r(role)
  CROSS JOIN unnest(ARRAY['pre_registration.claim_notifications(integer, timestamptz)',
                          'pre_registration.freeze_notification(uuid, uuid, text, jsonb)',
                          'pre_registration.complete_notification(uuid, uuid, text, text, text, timestamptz)',
                          'pre_registration.get_notification_context(uuid)',
                          'pre_registration._queue_delivery_alert(uuid)']) AS f(fn)
  WHERE has_function_privilege(r.role, f.fn, 'EXECUTE');
  PERFORM pg_temp.ok('anon and authenticated cannot run the email queue functions', v_callable IS NULL, v_callable);
END $$;

-- One unpaid order per family per feis is 019's index, which 020 checked when it was applied: draft and
-- pending_payment only, so a family can hold any number of paid orders
DO $$ DECLARE v_def text; BEGIN
  v_def := pg_get_indexdef(to_regclass('pre_registration.idx_registrations_active_unique'));
  PERFORM pg_temp.ok('the one-unpaid-order index is idx_registrations_active_unique, as 019 made it', v_def =
    'CREATE UNIQUE INDEX idx_registrations_active_unique ON pre_registration.registrations USING btree '
    '(feis_listing_id, household_id) WHERE (status = ANY (ARRAY[''draft''::text, ''pending_payment''::text]))',
    coalesce(v_def, 'no index by that name'));
END $$;

-- 012's hold-expiry job, naming its schema, and no other (002's, if it was scheduled under another name)
DO $$ DECLARE v_jobs text; v_command text; BEGIN
  SELECT string_agg(coalesce(jobname, jobid::text), ', ' ORDER BY jobid), min(command) INTO v_jobs, v_command
  FROM cron.job WHERE command ILIKE '%hold_expires_at%';
  PERFORM pg_temp.ok('one hold-expiry job, and it names its schema',
    v_jobs = 'expire-registration-holds' AND v_command LIKE '%pre_registration.registrations%', v_jobs);
END $$;

-- ---------- Add-on orders and $0 orders, through the real order functions (as admin) ----------
-- The fixture order is paid; each later order counts the family's paid orders as Submit does (_counted_orders).
-- After the first order, the family max is used up, so more dances inside it cost nothing.

DO $$ DECLARE v_result jsonb; BEGIN
  v_result := pg_temp.pay(pg_temp.id('order'), pg_temp.to_checkout(pg_temp.id('order')));
  PERFORM pg_temp.ok('the first order is paid through claim, attach and confirm_order_payment',
    v_result ->> 'result' = 'confirmed', v_result::text);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('the first order is paid through claim, attach and confirm_order_payment', false, SQLERRM); END $$;

DO $$ DECLARE v_result jsonb; BEGIN
  v_result := pre_registration.create_order(pg_temp.id('household'), pg_temp.id('feis'),
    pg_temp.payload(pg_temp.id('dancer'), pg_temp.id('comp'), 1500, 1500, pg_temp.counted()));
  PERFORM pg_temp.ok('an add-on for a dance already paid for is refused',
    v_result = '{"status": "refused", "reason": "already_entered"}'::jsonb, v_result::text);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('an add-on for a dance already paid for is refused', false, SQLERRM); END $$;

DO $$ DECLARE v_result jsonb; v_free uuid; v_row record; v_payment jsonb; BEGIN
  v_result := pre_registration.create_order(pg_temp.id('household'), pg_temp.id('feis'),
    pg_temp.payload(pg_temp.id('dancer'), pg_temp.id('comp2'), 1500, 1500, pg_temp.counted()));
  v_free := (v_result ->> 'registration_id')::uuid;
  INSERT INTO t_ids VALUES ('free', v_free);
  v_result := pre_registration.confirm_free_order(v_free, pg_temp.id('household'));
  SELECT status, total_cents, stripe_checkout_session_id, purchase_snapshot -> 'pricing' -> 'prior' -> 'orders' -> 0 ->> 'id' AS counted
  INTO v_row FROM pre_registration.registrations WHERE id = v_free;
  SELECT snapshot_data -> 'payment' INTO v_payment FROM pre_registration.registration_snapshots WHERE registration_id = v_free;
  PERFORM pg_temp.ok('a $0 add-on counts the paid order and is confirmed by confirm_free_order, with no Stripe payment',
    v_result ->> 'result' = 'confirmed' AND v_row.status = 'paid' AND v_row.total_cents = 0
      AND v_row.stripe_checkout_session_id IS NULL AND v_row.counted = pg_temp.id('order')::text
      AND (v_payment ->> 'amount_cents')::int = 0 AND v_payment ->> 'payment_intent_id' IS NULL,
    concat_ws(' | ', v_result::text, row_to_json(v_row)::text, v_payment::text));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.ok('a $0 add-on counts the paid order and is confirmed by confirm_free_order, with no Stripe payment', false, SQLERRM);
END $$;

-- Test Special is outside the family max, so it costs $10.00 and goes through Stripe
DO $$ DECLARE v_result jsonb; v_order uuid; v_checkout jsonb; BEGIN
  v_result := pre_registration.create_order(pg_temp.id('household'), pg_temp.id('feis'),
    pg_temp.payload(pg_temp.id('dancer'), pg_temp.id('special'), 1000, 0, pg_temp.counted()));
  v_order := (v_result ->> 'registration_id')::uuid;
  v_checkout := pg_temp.to_checkout(v_order);
  PERFORM pg_temp.expire(v_order, v_checkout);
  v_result := pg_temp.pay(v_order, v_checkout);
  PERFORM pg_temp.ok('a late payment for an add-on whose counted orders still hold is confirmed',
    v_result ->> 'result' = 'confirmed', v_result::text);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.ok('a late payment for an add-on whose counted orders still hold is confirmed', false, SQLERRM);
END $$;

DO $$ DECLARE v_result jsonb; v_late uuid; v_since uuid; v_checkout jsonb; v_why jsonb; BEGIN
  v_result := pre_registration.create_order(pg_temp.id('household'), pg_temp.id('feis'),
    pg_temp.payload(pg_temp.id('dancer2'), pg_temp.id('special'), 1000, 0, pg_temp.counted()));
  v_late := (v_result ->> 'registration_id')::uuid;
  v_checkout := pg_temp.to_checkout(v_late);
  PERFORM pg_temp.expire(v_late, v_checkout);
  -- The family starts again and another order is paid (here a $0 one), priced without the expired order
  v_result := pre_registration.create_order(pg_temp.id('household'), pg_temp.id('feis'),
    pg_temp.payload(pg_temp.id('dancer2'), pg_temp.id('comp'), 1500, 1500, pg_temp.counted()));
  v_since := (v_result ->> 'registration_id')::uuid;
  PERFORM pre_registration.confirm_free_order(v_since, pg_temp.id('household'));
  v_result := pg_temp.pay(v_late, v_checkout);
  SELECT details -> 'why' INTO v_why FROM pre_registration.payment_exceptions
  WHERE registration_id = v_late AND reason = 'late_payment_conflict';
  PERFORM pg_temp.ok('a late payment after another order was paid that it did not count is a case',
    v_result ->> 'reason' = 'late_payment_conflict'
      AND v_why = jsonb_build_array(jsonb_build_object('rule', 'paid_orders_changed', 'orders', jsonb_build_array(v_since)))
      AND (SELECT status FROM pre_registration.registrations WHERE id = v_late) = 'expired',
    concat_ws(' | ', v_result::text, v_why::text));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.ok('a late payment after another order was paid that it did not count is a case', false, SQLERRM);
END $$;

-- The organiser entries view lists the family's add-on entries too: four paid orders, one dance each (the
-- expired order's entry stays off the list)
DO $$ DECLARE v_orders int; v_entries int; v_named int; BEGIN
  PERFORM pg_temp.as_user('organiser');
  SELECT count(*) INTO v_orders FROM pre_registration.registrations
  WHERE feis_listing_id = pg_temp.id('feis') AND status = 'paid';
  SELECT count(*), count(d.first_name) INTO v_entries, v_named
  FROM pre_registration.registration_entries e
  JOIN pre_registration.registrations r ON r.id = e.registration_id
  LEFT JOIN pre_registration.dancers d ON d.id = e.dancer_id
  WHERE r.feis_listing_id = pg_temp.id('feis') AND r.status IN ('paid', 'pending_payment', 'draft');
  PERFORM pg_temp.as_admin();
  PERFORM pg_temp.ok('the organiser reads every paid order and entry, add-ons included',
    v_orders = 4 AND v_entries = 4 AND v_named = 4,
    format('paid orders %s, entries %s, dancer names %s', v_orders, v_entries, v_named));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.ok('the organiser reads every paid order and entry, add-ons included', false, SQLERRM);
END $$;

-- ---------- Report (always raises, so everything above rolls back) ----------
DO $$
DECLARE v_pass int; v_total int; v_failed text;
BEGIN
  SELECT count(*) FILTER (WHERE ok), count(*) INTO v_pass, v_total FROM t_results;
  SELECT string_agg(name || COALESCE(' [' || detail || ']', ''), ' | ' ORDER BY n) INTO v_failed FROM t_results WHERE NOT ok;
  RAISE EXCEPTION 'PAYMENT HARDENING LIVE TESTS: %/% passed; FAILED: %', v_pass, v_total, COALESCE(v_failed, 'none');
END $$;
