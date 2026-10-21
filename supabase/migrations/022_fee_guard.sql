-- 022_fee_guard.sql
-- A feis that is open, closed or launched cannot be saved with a $0 fee for a kind of competition it
-- offers. The same rule as getFeeBlockReasons in src/lib/feis-listing-states.ts, which the Fees step
-- runs first for the plain message; this stops a direct API call from skipping it.
-- Re-runnable; applied by hand in the SQL editor, as postgres.

SET search_path TO pre_registration, public;

-- Applies only to anon and authenticated, like guard_feis_listings (021). A draft may hold $0 while it
-- is set up, and a pending feis is already frozen by guard_pending_fee_schedules.
CREATE OR REPLACE FUNCTION guard_fee_schedule_amounts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pre_registration, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM feis_listings
    WHERE id = NEW.feis_listing_id AND status IN ('open', 'closed', 'launched')
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.solo_fee_cents = 0
     AND EXISTS (SELECT 1 FROM feis_competitions
                 WHERE feis_listing_id = NEW.feis_listing_id AND fee_category = 'solo') THEN
    RAISE EXCEPTION 'Solo fee must be greater than $0 when solo competitions exist' USING ERRCODE = '23514';
  END IF;
  IF NEW.prelim_champ_fee_cents = 0
     AND EXISTS (SELECT 1 FROM feis_competitions
                 WHERE feis_listing_id = NEW.feis_listing_id AND fee_category = 'prelim_champ') THEN
    RAISE EXCEPTION 'Championship fee must be greater than $0 when championship competitions exist'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.open_champ_fee_cents = 0
     AND EXISTS (SELECT 1 FROM feis_competitions
                 WHERE feis_listing_id = NEW.feis_listing_id AND fee_category = 'open_champ') THEN
    RAISE EXCEPTION 'Championship fee must be greater than $0 when championship competitions exist'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_fee_schedule_amounts ON fee_schedules;
CREATE TRIGGER guard_fee_schedule_amounts
  BEFORE INSERT OR UPDATE ON fee_schedules
  FOR EACH ROW EXECUTE FUNCTION guard_fee_schedule_amounts();
