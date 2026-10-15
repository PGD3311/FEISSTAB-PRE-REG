-- 008_fee_rules.sql
-- Fee rules to match how feiseanna actually charge:
--   * late fees in tiers that step up by date, each with an optional family max
--   * a per-competition price (Future Champ, teams, art...) instead of only the category fee
--   * competitions that sit outside the family cap
-- Additive only: late_fee_cents stays for older builds but the app now reads late_fee_tiers.

SET search_path TO pre_registration, public;

ALTER TABLE fee_schedules
  ADD COLUMN IF NOT EXISTS late_fee_tiers jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(late_fee_tiers) = 'array');

COMMENT ON COLUMN fee_schedules.late_fee_tiers IS
  'Array of {starts_at, fee_cents, family_max_cents}. The latest tier that has started applies; fee is per dancer.';
COMMENT ON COLUMN fee_schedules.family_cap_cents IS
  'Most a family pays in competition entry fees. Excludes event fee, late fees, day-of surcharges and excluded competitions.';
COMMENT ON COLUMN fee_schedules.late_fee_cents IS
  'Deprecated: replaced by late_fee_tiers.';

-- Carry the old single late fee over as tier 1, starting when normal registration closes
UPDATE fee_schedules f
SET late_fee_tiers = jsonb_build_array(jsonb_build_object(
      'starts_at', to_char(l.reg_closes_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'fee_cents', f.late_fee_cents,
      'family_max_cents', NULL))
FROM feis_listings l
WHERE l.id = f.feis_listing_id
  AND f.late_fee_cents > 0
  AND l.reg_closes_at IS NOT NULL
  AND f.late_fee_tiers = '[]'::jsonb;

ALTER TABLE feis_competitions
  ADD COLUMN IF NOT EXISTS fee_cents integer CHECK (fee_cents >= 0),
  ADD COLUMN IF NOT EXISTS exclude_from_family_cap boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN feis_competitions.fee_cents IS
  'Price for this competition. NULL means use the fee schedule''s category fee.';
