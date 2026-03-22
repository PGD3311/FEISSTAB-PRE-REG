-- 005_performance_indexes.sql
-- Performance audit fixes: missing indexes, composite indexes, RLS optimization

SET search_path TO pre_registration, public;

-- ================================================================
-- 1. Missing indexes on queried columns
-- ================================================================

-- Stripe checkout session lookup after payment redirect
CREATE INDEX idx_registrations_stripe_session
  ON registrations(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

-- FK column on registration_entries without index
CREATE INDEX idx_registration_entries_dancer_id
  ON registration_entries(dancer_id);

-- Composite for the landing page query (status + date sort)
CREATE INDEX idx_feis_listings_status_feis_date
  ON feis_listings(status, feis_date);

-- ================================================================
-- 2. Composite indexes replacing individual ones
-- ================================================================

-- Most common query pattern is (feis_listing_id, status) together
DROP INDEX IF EXISTS idx_registrations_feis_listing_id;
DROP INDEX IF EXISTS idx_registrations_status;
CREATE INDEX idx_registrations_feis_listing_status
  ON registrations(feis_listing_id, status);

-- Enabled competitions for a feis (6+ callsites)
CREATE INDEX idx_feis_competitions_listing_enabled
  ON feis_competitions(feis_listing_id, enabled)
  WHERE enabled = true;

-- ================================================================
-- 3. FK columns missing indexes
-- ================================================================

-- cloned_from FK without index
CREATE INDEX idx_feis_listings_cloned_from
  ON feis_listings(cloned_from)
  WHERE cloned_from IS NOT NULL;

-- syllabus_templates.created_by used in RLS
CREATE INDEX idx_syllabus_templates_created_by
  ON syllabus_templates(created_by)
  WHERE created_by IS NOT NULL;

-- ================================================================
-- 4. RLS performance: auth_household_id() helper
-- ================================================================
CREATE OR REPLACE FUNCTION auth_household_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT id FROM pre_registration.households WHERE user_id = auth.uid()
$$;

-- Simplify triple-nested policies on registration_entries
DROP POLICY IF EXISTS "Entries follow registration (parent)" ON registration_entries;
CREATE POLICY "Entries follow registration (parent)" ON registration_entries
  FOR ALL USING (
    registration_id IN (
      SELECT id FROM registrations WHERE household_id = auth_household_id()
    )
  );

-- Simplify triple-nested policies on registration_snapshots
DROP POLICY IF EXISTS "Snapshots follow registration" ON registration_snapshots;
CREATE POLICY "Snapshots follow registration" ON registration_snapshots
  FOR ALL USING (
    registration_id IN (
      SELECT id FROM registrations WHERE household_id = auth_household_id()
    )
  );

-- Simplify dancer_dance_levels RLS
DROP POLICY IF EXISTS "Levels follow dancer access" ON dancer_dance_levels;
CREATE POLICY "Levels follow dancer access" ON dancer_dance_levels
  FOR ALL USING (
    dancer_id IN (
      SELECT id FROM dancers WHERE household_id = auth_household_id()
    )
  );

-- Simplify dancers RLS
DROP POLICY IF EXISTS "Users manage own dancers" ON dancers;
CREATE POLICY "Users manage own dancers" ON dancers
  FOR ALL USING (household_id = auth_household_id());

-- Simplify registrations parent RLS
DROP POLICY IF EXISTS "Parents manage own registrations" ON registrations;
CREATE POLICY "Parents manage own registrations" ON registrations
  FOR ALL USING (household_id = auth_household_id());

-- ================================================================
-- 5. Missing organiser policy on registration_snapshots
-- ================================================================
CREATE POLICY "Organisers see snapshots for their feiseanna" ON registration_snapshots
  FOR SELECT USING (
    registration_id IN (
      SELECT id FROM registrations
      WHERE feis_listing_id IN (SELECT id FROM feis_listings WHERE created_by = auth.uid())
    )
  );
