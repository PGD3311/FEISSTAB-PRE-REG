-- 020_assert_unpaid_index.sql
-- Payment hardening, last step: refuse to apply unless one unpaid order per family per feis is enforced by
-- exactly 019's index. 012–017 rely on it and never create or drop it: create_order refuses a second unpaid
-- order with a clear message before the index would, and confirmation decides conflicts by explicit checks,
-- since a move into paid can't touch an index that covers only draft and pending_payment. This file runs last
-- either way: live after 012–017 (019 is already there), and in the tests after 019. Spec §2, Rollout.

DO $$
DECLARE
  v_def text := pg_get_indexdef(to_regclass('pre_registration.idx_registrations_active_unique'));
  v_expected constant text :=
    'CREATE UNIQUE INDEX idx_registrations_active_unique ON pre_registration.registrations USING btree '
    '(feis_listing_id, household_id) WHERE (status = ANY (ARRAY[''draft''::text, ''pending_payment''::text]))';
BEGIN
  IF v_def IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'idx_registrations_active_unique must be 019''s one-unpaid-order index, but is: %',
      coalesce(v_def, 'missing');
  END IF;
END $$;
