-- 010_household_contact.sql
-- * Parent / account-holder contact details on households (name, phone, address)
-- * Organisers can read the households and dancers registered for their own feiseanna.
--   Before this, RLS only let parents read their own rows, so the organiser's entries list
--   came back without names.

SET search_path TO pre_registration, public;

ALTER TABLE households
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_line2 text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state_region text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'US',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Households with a registration (any status) for a feis the current user organises
CREATE OR REPLACE FUNCTION organiser_household_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT DISTINCT r.household_id
  FROM pre_registration.registrations r
  JOIN pre_registration.feis_listings l ON l.id = r.feis_listing_id
  WHERE l.created_by = auth.uid()
$$;

-- Dancers entered in a feis the current user organises
CREATE OR REPLACE FUNCTION organiser_dancer_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT DISTINCT e.dancer_id
  FROM pre_registration.registration_entries e
  JOIN pre_registration.registrations r ON r.id = e.registration_id
  JOIN pre_registration.feis_listings l ON l.id = r.feis_listing_id
  WHERE l.created_by = auth.uid()
$$;

REVOKE ALL ON FUNCTION organiser_household_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION organiser_dancer_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION organiser_household_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION organiser_dancer_ids() TO authenticated;

DROP POLICY IF EXISTS "Organisers see registered households" ON households;
CREATE POLICY "Organisers see registered households" ON households
  FOR SELECT TO authenticated
  USING (id IN (SELECT organiser_household_ids()));

DROP POLICY IF EXISTS "Organisers see registered dancers" ON dancers;
CREATE POLICY "Organisers see registered dancers" ON dancers
  FOR SELECT TO authenticated
  USING (id IN (SELECT organiser_dancer_ids()));
