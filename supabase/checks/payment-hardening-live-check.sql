-- payment-hardening-live-check.sql: READ ONLY. Run before applying 012–017 and 020 (Rollout step 1) and after.

-- 1. Who can do what on the three order tables
SELECT tablename, policyname, cmd, array_to_string(roles, ',') AS roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'pre_registration' AND tablename IN ('registrations', 'registration_entries', 'registration_snapshots')
ORDER BY tablename, policyname;

-- The table ACLs themselves, with who granted each privilege: REVOKE only removes the runner's own grants
SELECT c.relname AS tbl, CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
       a.grantor::regrole AS grantor, string_agg(a.privilege_type, ',' ORDER BY a.privilege_type) AS privileges
FROM pg_class c
CROSS JOIN LATERAL aclexplode(c.relacl) AS a
WHERE c.relnamespace = 'pre_registration'::regnamespace
  AND c.relname IN ('registrations', 'registration_entries', 'registration_snapshots')
  AND (a.grantee = 0 OR a.grantee IN ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole))
GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

-- Which registrations columns authenticated can read (consent_ip and checkout_config must be missing after 012)
SELECT column_name FROM information_schema.column_privileges
WHERE table_schema = 'pre_registration' AND table_name = 'registrations'
  AND grantee = 'authenticated' AND privilege_type = 'SELECT'
ORDER BY column_name;

-- Column-level write grants, which the table ACLs above don't show
SELECT r.role, t.tbl, p.priv
FROM unnest(ARRAY['anon', 'authenticated']) AS r(role)
CROSS JOIN unnest(ARRAY['registrations', 'registration_entries', 'registration_snapshots']) AS t(tbl)
CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE']) AS p(priv)
WHERE has_any_column_privilege(r.role, 'pre_registration.' || t.tbl, p.priv);

-- Row-level security, whether the service role can TRUNCATE, and every trigger on the three tables
-- (after 012: the three guards and the three TRUNCATE guards; before it, maybe 011's guard_parent_registration_write)
SELECT relname, relrowsecurity,
       has_table_privilege('service_role', oid, 'TRUNCATE') AS service_role_can_truncate
FROM pg_class
WHERE relnamespace = 'pre_registration'::regnamespace
  AND relname IN ('registrations', 'registration_entries', 'registration_snapshots')
ORDER BY relname;
SELECT tgrelid::regclass AS tbl, tgname, tgenabled
FROM pg_trigger
WHERE NOT tgisinternal
  AND tgrelid IN ('pre_registration.registrations'::regclass, 'pre_registration.registration_entries'::regclass,
                  'pre_registration.registration_snapshots'::regclass)
ORDER BY 1, 2;

-- 2. Leftovers from the parked pay-at-the-door work (011): its functions, status check, columns and orders
SELECT proname, pg_get_function_identity_arguments(oid) AS args FROM pg_proc
WHERE pronamespace = 'pre_registration'::regnamespace
  AND proname IN ('confirm_pay_at_door', 'mark_registration_paid', 'guard_parent_registration_write');
SELECT pg_get_constraintdef(oid) AS status_check FROM pg_constraint WHERE conname = 'registrations_status_check';
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'pre_registration'
  AND ((table_name = 'feis_listings' AND column_name = 'allow_pay_at_door')
    OR (table_name = 'registrations' AND column_name = 'payment_method'));
-- Orders in a status outside 012's state table ('confirmed' comes from 011)
SELECT status, count(*) FROM pre_registration.registrations
WHERE status NOT IN ('draft', 'pending_payment', 'paid', 'expired', 'cancelled') GROUP BY status;
-- Only if the query above it listed registrations.payment_method:
-- SELECT payment_method, count(*) FROM pre_registration.registrations GROUP BY payment_method;

-- 3. Cron jobs. 002's hold-expiry job names no schema, so it may have been failing every minute. 012
-- replaces the job called 'expire-registration-holds'; any other job listed in the second query is 002's
-- under another name, and has to be unscheduled when 012 goes live.
SELECT jobid, jobname, schedule, command, active FROM cron.job ORDER BY jobid;
SELECT jobid, jobname, command FROM cron.job WHERE command ILIKE '%hold_expires_at%' ORDER BY jobid;
SELECT j.jobname, d.status, d.return_message, d.start_time
FROM cron.job_run_details d JOIN cron.job j USING (jobid)
ORDER BY d.start_time DESC LIMIT 20;

-- 4. Orders by status; unpaid orders that 012 will expire; paid orders with no snapshot row
SELECT status, count(*) FROM pre_registration.registrations GROUP BY status ORDER BY status;
SELECT id, status, created_at, hold_expires_at, stripe_checkout_session_id
FROM pre_registration.registrations WHERE status IN ('draft', 'pending_payment') ORDER BY created_at;
-- 012 keeps these as they are (with purchase_snapshot NULL), and nothing can add a snapshot to them later
SELECT r.id, r.paid_at, r.confirmation_number FROM pre_registration.registrations r
WHERE r.status = 'paid'
  AND NOT EXISTS (SELECT 1 FROM pre_registration.registration_snapshots s WHERE s.registration_id = r.id);

-- 5. Duplicates the new unique keys would reject
SELECT registration_id, count(*) FROM pre_registration.registration_snapshots GROUP BY registration_id HAVING count(*) > 1;
SELECT stripe_payment_intent_id, count(*) FROM pre_registration.registrations
WHERE stripe_payment_intent_id IS NOT NULL GROUP BY stripe_payment_intent_id HAVING count(*) > 1;
SELECT stripe_checkout_session_id, count(*) FROM pre_registration.registrations
WHERE stripe_checkout_session_id IS NOT NULL GROUP BY stripe_checkout_session_id HAVING count(*) > 1;

-- 6. Paid orders whose total doesn't match their entries (the old webhook overwrote totals)
SELECT r.id, r.total_cents, r.event_fee_cents,
       sum(e.base_fee_cents + e.late_fee_cents + e.day_of_surcharge_cents) AS entry_fees
FROM pre_registration.registrations r
JOIN pre_registration.registration_entries e ON e.registration_id = r.id
WHERE r.status = 'paid'
GROUP BY r.id
HAVING r.total_cents > sum(e.base_fee_cents + e.late_fee_cents + e.day_of_surcharge_cents) + r.event_fee_cents;

-- 7. Feiseanna open for registration, the Postgres version, and the extensions this work needs
SELECT id, name, status, reg_closes_at, stripe_account_id IS NOT NULL AS has_stripe
FROM pre_registration.feis_listings WHERE status = 'open';
SELECT current_setting('server_version') AS postgres_version;
SELECT extname, extnamespace::regnamespace AS schema FROM pg_extension
WHERE extname IN ('pg_cron', 'pg_net', 'uuid-ossp', 'pgcrypto');

-- 8. Order columns that 012's guards and 013–017 read but live lacks (none expected; 012 adds
-- purchase_snapshot and the checkout columns itself)
SELECT c AS missing_column
FROM unnest(ARRAY['id', 'feis_listing_id', 'household_id', 'status', 'confirmation_number',
  'stripe_checkout_session_id', 'stripe_payment_intent_id', 'stripe_charge_id', 'total_cents',
  'application_fee_cents', 'event_fee_cents', 'is_late', 'consent_accepted_at', 'consent_version',
  'platform_terms_version', 'consent_ip', 'hold_expires_at', 'created_at', 'updated_at', 'paid_at']) AS c
WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'pre_registration' AND table_name = 'registrations' AND column_name = c);

-- 9. Indexes on orders. One unpaid order per family per feis is 019's idx_registrations_active_unique (draft and
-- pending_payment only). 012–017 rely on it and never create or drop it, and 020 refuses to apply without it
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'pre_registration' AND tablename = 'registrations' ORDER BY indexname;

-- 10. Add-ons made by main's live code (019 lets a family pay for several orders per feis)
-- Families with more than one paid order for a feis
SELECT household_id, feis_listing_id, count(*) AS paid_orders
FROM pre_registration.registrations WHERE status = 'paid'
GROUP BY household_id, feis_listing_id HAVING count(*) > 1;
-- A dancer paid for twice in one competition (main checked this in TypeScript only)
SELECT r.feis_listing_id, e.dancer_id, e.feis_competition_id, array_agg(r.id ORDER BY r.paid_at) AS orders
FROM pre_registration.registration_entries e
JOIN pre_registration.registrations r ON r.id = e.registration_id
WHERE r.status = 'paid'
GROUP BY r.feis_listing_id, e.dancer_id, e.feis_competition_id HAVING count(*) > 1;
-- The family fee paid on more than one order for a feis (main's add-on path took no lock)
SELECT household_id, feis_listing_id, array_agg(id ORDER BY paid_at) AS orders, sum(event_fee_cents) AS event_fees
FROM pre_registration.registrations WHERE status = 'paid' AND event_fee_cents > 0
GROUP BY household_id, feis_listing_id HAVING count(*) > 1;
-- Paid orders with a total of 0 (main's free path: no claim and no session); section 4 lists paid orders with no
-- snapshot row, which these are too
SELECT id, household_id, feis_listing_id, confirmation_number, paid_at, stripe_checkout_session_id
FROM pre_registration.registrations WHERE status = 'paid' AND total_cents = 0;
