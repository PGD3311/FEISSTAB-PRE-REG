#!/usr/bin/env bash
# rehearse-on-live-copy.sh: applies migrations 012–017 and then 020 to a copy of the live pre_registration
# data, which already has 019 (spec, Rollout step 1). It reads live once and never writes to it. The copy only ever lives in a
# temporary folder and a throwaway Postgres 17, and both are deleted when the script ends.
# Usage: LIVE_DB_URL='<connection string>' supabase/checks/rehearse-on-live-copy.sh
set -euo pipefail

: "${LIVE_DB_URL:?Set LIVE_DB_URL to the live database connection string}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG="${PG_BIN:-$(brew --prefix postgresql@17)/bin}"
WORK="$(mktemp -d)"
cleanup() {
  "$PG/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

live() { "$PG/psql" "$LIVE_DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }
copy() { PGOPTIONS='-c client_min_messages=warning' "$PG/psql" -h "$WORK" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
value() { copy -At -c "$1"; }

echo '== 1. Copying live (read-only)'
"$PG/pg_dump" "$LIVE_DB_URL" --schema=pre_registration --no-owner --no-privileges --file="$WORK/dump.sql"
live -c "\copy (SELECT id, email, aud, role, coalesce(created_at, now()) FROM auth.users) TO '$WORK/users.csv' CSV"
live -c "\copy (SELECT jobname, schedule, command FROM cron.job) TO '$WORK/cron_jobs.csv' CSV"
live -At -c "SELECT format('CREATE SCHEMA IF NOT EXISTS %I; CREATE EXTENSION IF NOT EXISTS %I WITH SCHEMA %I;',
    n.nspname, e.extname, n.nspname)
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname IN ('uuid-ossp', 'pgcrypto')" > "$WORK/extensions.sql"

echo '== 2. Restoring it into a throwaway Postgres'
"$PG/initdb" -D "$WORK/data" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
"$PG/pg_ctl" -D "$WORK/data" -w -l "$WORK/server.log" \
  -o "-c listen_addresses='' -c unix_socket_directories='$WORK' -c timezone=UTC -c fsync=off -c wal_level=logical" \
  start >/dev/null
# The tests' Supabase stand-ins: the API roles, auth.users and auth.uid(), pg_cron's job table, and the
# pre_registration schema with Supabase's default grants on everything created in it
copy -f "$ROOT/tests/db/sql/supabase-standins.sql"
copy <<'SQL'
-- More of Supabase that a dump of pre_registration may refer to
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role' $$;
CREATE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('request.jwt.claims', true), '')::json ->> 'email' $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE
  AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
CREATE PUBLICATION supabase_realtime;
SQL
copy -f "$WORK/extensions.sql"
copy -c "\copy auth.users (id, email, aud, role, created_at) FROM '$WORK/users.csv' CSV"
# The stand-ins have made the schema already
sed 's/^CREATE SCHEMA pre_registration;$/CREATE SCHEMA IF NOT EXISTS pre_registration;/' "$WORK/dump.sql" > "$WORK/restore.sql"
copy -f "$WORK/restore.sql" >/dev/null
copy -c "\copy cron.job (jobname, schedule, command) FROM '$WORK/cron_jobs.csv' CSV"

PAID="SELECT count(*) || ' paid, fingerprint ' || md5(coalesce(string_agg(concat_ws('|', id, household_id,
    feis_listing_id, total_cents, application_fee_cents, event_fee_cents, confirmation_number,
    stripe_checkout_session_id, stripe_payment_intent_id, stripe_charge_id, paid_at), ',' ORDER BY id), ''))
  FROM pre_registration.registrations WHERE status = 'paid'"
PAID_NO_SNAPSHOT_ROW="SELECT count(*) FROM pre_registration.registrations r WHERE r.status = 'paid'
  AND NOT EXISTS (SELECT 1 FROM pre_registration.registration_snapshots s WHERE s.registration_id = r.id)"
UNPAID="SELECT count(*) FROM pre_registration.registrations WHERE status IN ('draft', 'pending_payment')"
EXPIRED="SELECT count(*) FROM pre_registration.registrations WHERE status = 'expired'"
CONFIRMED="SELECT count(*) FROM pre_registration.registrations WHERE status = 'confirmed'"
LEFTOVERS="SELECT coalesce(string_agg(proname, ', ' ORDER BY proname), 'none') FROM pg_proc
  WHERE pronamespace = 'pre_registration'::regnamespace
    AND proname IN ('confirm_pay_at_door', 'mark_registration_paid', 'guard_parent_registration_write')"
HOLD_JOBS="SELECT coalesce(string_agg(coalesce(jobname, jobid::text) || ': ' || regexp_replace(command, '\s+', ' ', 'g'),
    ' | ' ORDER BY jobid), 'none')
  FROM cron.job WHERE command ILIKE '%hold_expires_at%'"
# Add-ons made by main's live code: families with several paid orders for a feis, and paid $0 orders
SEVERAL_PAID="SELECT count(*) FROM (SELECT 1 FROM pre_registration.registrations WHERE status = 'paid'
  GROUP BY household_id, feis_listing_id HAVING count(*) > 1) AS f"
FREE_PAID="SELECT count(*) FROM pre_registration.registrations WHERE status = 'paid' AND total_cents = 0"
UNPAID_INDEX="SELECT coalesce(pg_get_indexdef(to_regclass('pre_registration.idx_registrations_active_unique')), 'none')"
INDEX_019="CREATE UNIQUE INDEX idx_registrations_active_unique ON pre_registration.registrations USING btree (feis_listing_id, household_id) WHERE (status = ANY (ARRAY['draft'::text, 'pending_payment'::text]))"

report() {
  echo "   orders by status:       $(value "SELECT coalesce(string_agg(status || ' ' || n, ', ' ORDER BY status), 'none')
    FROM (SELECT status, count(*) AS n FROM pre_registration.registrations GROUP BY status) s")"
  echo "   paid orders:            $(value "$PAID")"
  echo "   paid, no snapshot row:  $(value "$PAID_NO_SNAPSHOT_ROW")"
  echo "   unpaid orders:          $(value "$UNPAID")"
  echo "   'confirmed' orders:     $(value "$CONFIRMED")"
  echo "   status check:           $(value "SELECT coalesce(pg_get_constraintdef(oid), 'none') FROM pg_constraint
    WHERE conname = 'registrations_status_check'")"
  echo "   011 functions:          $(value "$LEFTOVERS")"
  echo "   triggers on orders:     $(value "SELECT coalesce(string_agg(tgname, ', ' ORDER BY tgname), 'none') FROM pg_trigger
    WHERE tgrelid = 'pre_registration.registrations'::regclass AND NOT tgisinternal")"
  echo "   hold-expiry jobs:       $(value "$HOLD_JOBS")"
  echo "   several paid orders:    $(value "$SEVERAL_PAID") families"
  echo "   paid \$0 orders:        $(value "$FREE_PAID")"
  echo "   unpaid-order index:     $(value "$UNPAID_INDEX")"
}

echo '== 3. Before 012–017 and 020'
report
paid_before="$(value "$PAID")"
paid_no_row_before="$(value "$PAID_NO_SNAPSHOT_ROW")"
several_paid_before="$(value "$SEVERAL_PAID")"
free_paid_before="$(value "$FREE_PAID")"
expired_expected=$(( $(value "$EXPIRED") + $(value "$UNPAID") ))

echo '== 4. Applying 012–017, then 020, one transaction per file, as apply_migration does'
for file in "$ROOT"/supabase/migrations/01[2-7]_*.sql "$ROOT"/supabase/migrations/020_*.sql; do
  echo "   $(basename "$file")"
  copy --single-transaction -f "$file" >/dev/null
done

echo '== 5. After'
report
failures=()
[[ "$(value "$PAID")" == "$paid_before" ]] || failures+=('paid orders changed')
[[ "$(value "$PAID_NO_SNAPSHOT_ROW")" == "$paid_no_row_before" ]] || failures+=('paid orders without a snapshot row changed')
[[ "$(value "$SEVERAL_PAID")" == "$several_paid_before" ]] || failures+=('families with several paid orders changed')
[[ "$(value "$FREE_PAID")" == "$free_paid_before" ]] || failures+=('paid $0 orders changed')
[[ "$(value "$UNPAID_INDEX")" == "$INDEX_019" ]] || failures+=("the unpaid-order index is not 019's")
[[ "$(value "$UNPAID")" == 0 ]] || failures+=('unpaid orders remain')
[[ "$(value "$EXPIRED")" == "$expired_expected" ]] || failures+=('not every legacy unpaid order expired')
[[ "$(value "$LEFTOVERS")" == none ]] || failures+=('011 functions remain')
[[ "$(value "$CONFIRMED")" == 0 ]] || failures+=("'confirmed' orders exist: 012 freezes them; ask Daniel")
[[ "$(value "$HOLD_JOBS")" == 'expire-registration-holds: '*'pre_registration.registrations'* &&
   "$(value "SELECT count(*) FROM cron.job WHERE command ILIKE '%hold_expires_at%'")" == 1 ]] ||
  failures+=("the hold-expiry jobs are not exactly 012's one")

echo '== 6. The live test script, on the copy'
if output="$(copy --single-transaction -f "$ROOT/supabase/tests/payment_hardening_live_tests.sql" 2>&1)"; then
  failures+=('the live test script finished without its report')
else
  result="$(printf '%s\n' "$output" | grep -o 'PAYMENT HARDENING LIVE TESTS: .*' || true)"
  echo "${result:-$output}"
  pattern='^PAYMENT HARDENING LIVE TESTS: ([0-9]+)/([0-9]+) passed; FAILED: none$'
  if [[ "$result" =~ $pattern ]] && [[ "${BASH_REMATCH[1]}" == "${BASH_REMATCH[2]}" ]]; then
    :
  else
    failures+=('the live tests failed')
  fi
fi

if (( ${#failures[@]} > 0 )); then
  printf 'REHEARSAL FAILED: %s\n' "${failures[@]}"
  exit 1
fi
echo 'REHEARSAL PASSED'
