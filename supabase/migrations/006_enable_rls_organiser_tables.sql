-- 001 section 6 (RLS for organiser tables) never reached the live DB.
-- Supabase flagged rls_disabled_in_public on these four tables. Applied 2026-09-22.
SET search_path TO pre_registration;

ALTER TABLE feis_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE syllabus_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE feis_competitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Organisers manage own listings" ON feis_listings;
CREATE POLICY "Organisers manage own listings" ON feis_listings
  FOR ALL USING (auth.uid() = created_by);
DROP POLICY IF EXISTS "Public can view open listings" ON feis_listings;
CREATE POLICY "Public can view open listings" ON feis_listings
  FOR SELECT USING (status = 'open');

DROP POLICY IF EXISTS "Fee schedules follow listing" ON fee_schedules;
CREATE POLICY "Fee schedules follow listing" ON fee_schedules
  FOR ALL USING (feis_listing_id IN (SELECT id FROM feis_listings WHERE created_by = auth.uid()));
DROP POLICY IF EXISTS "Public fee schedules for open listings" ON fee_schedules;
CREATE POLICY "Public fee schedules for open listings" ON fee_schedules
  FOR SELECT USING (feis_listing_id IN (SELECT id FROM feis_listings WHERE status = 'open'));

DROP POLICY IF EXISTS "System templates visible to all" ON syllabus_templates;
CREATE POLICY "System templates visible to all" ON syllabus_templates
  FOR SELECT USING (is_system = true);
DROP POLICY IF EXISTS "Users manage own templates" ON syllabus_templates;
CREATE POLICY "Users manage own templates" ON syllabus_templates
  FOR ALL USING (created_by = auth.uid());

DROP POLICY IF EXISTS "Competitions follow listing" ON feis_competitions;
CREATE POLICY "Competitions follow listing" ON feis_competitions
  FOR ALL USING (feis_listing_id IN (SELECT id FROM feis_listings WHERE created_by = auth.uid()));
DROP POLICY IF EXISTS "Public competitions for open listings" ON feis_competitions;
CREATE POLICY "Public competitions for open listings" ON feis_competitions
  FOR SELECT USING (feis_listing_id IN (SELECT id FROM feis_listings WHERE status = 'open'));

ALTER FUNCTION pre_registration.update_updated_at() SET search_path = pre_registration, public;
