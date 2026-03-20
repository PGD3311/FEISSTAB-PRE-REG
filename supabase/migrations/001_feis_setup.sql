-- 001_feis_setup.sql
-- Pre-registration: organiser feis setup tables
-- Tables live in the public schema. Isolation from Phase 1 is achieved
-- via separate Supabase projects, not separate schemas.

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Auto-update updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 1. feis_listings — core feis record (pre-registration only)
-- ============================================================
CREATE TABLE feis_listings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text,
  feis_date date,
  end_date date,
  venue_name text,
  venue_address text,
  contact_email text,
  contact_phone text,
  description text,
  timezone text DEFAULT 'America/New_York',
  age_cutoff_date date,
  sanctioning_body text NOT NULL DEFAULT 'CLRG'
    CHECK (sanctioning_body IN ('CLRG')),
  season_year integer,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'closed')),
  reg_opens_at timestamptz,
  reg_closes_at timestamptz,
  late_reg_closes_at timestamptz,
  dancer_cap integer,
  syllabus_template_id uuid,
  syllabus_snapshot jsonb,
  cloned_from uuid REFERENCES feis_listings(id),
  stripe_account_id text,
  stripe_onboarding_complete boolean NOT NULL DEFAULT false,
  stripe_charges_enabled boolean NOT NULL DEFAULT false,
  stripe_payouts_enabled boolean NOT NULL DEFAULT false,
  privacy_policy_url text,
  terms_url text,
  accepted_dpa_at timestamptz,
  show_contact_publicly boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER feis_listings_updated_at
  BEFORE UPDATE ON feis_listings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_feis_listings_created_by ON feis_listings(created_by);
CREATE INDEX idx_feis_listings_status ON feis_listings(status);

-- ============================================================
-- 2. fee_schedules — one-to-one with feis_listings (cents)
-- ============================================================
CREATE TABLE fee_schedules (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  feis_listing_id uuid NOT NULL UNIQUE REFERENCES feis_listings(id) ON DELETE CASCADE,
  event_fee_cents integer NOT NULL DEFAULT 0,
  solo_fee_cents integer NOT NULL DEFAULT 0,
  prelim_champ_fee_cents integer NOT NULL DEFAULT 0,
  open_champ_fee_cents integer NOT NULL DEFAULT 0,
  family_cap_cents integer,
  late_fee_cents integer NOT NULL DEFAULT 0,
  day_of_surcharge_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER fee_schedules_updated_at
  BEFORE UPDATE ON fee_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 3. syllabus_templates — system + custom templates
-- ============================================================
CREATE TABLE syllabus_templates (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  description text,
  template_data jsonb NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 4. feis_competitions — expanded syllabus (pre-reg offerings)
-- ============================================================
CREATE TABLE feis_competitions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  feis_listing_id uuid NOT NULL REFERENCES feis_listings(id) ON DELETE CASCADE,
  -- NULL for cross-age specials (e.g., Ceili). Parallels nullable dance_key for championships.
  age_group_key text,
  age_group_label text,
  age_max_jan1 integer,
  age_min_jan1 integer,
  level_key text,
  level_label text,
  dance_key text,
  dance_label text,
  competition_type text NOT NULL DEFAULT 'solo'
    CHECK (competition_type IN ('solo', 'championship', 'special', 'custom')),
  championship_key text
    CHECK (championship_key IN ('prelim', 'open') OR championship_key IS NULL),
  fee_category text NOT NULL
    CHECK (fee_category IN ('solo', 'prelim_champ', 'open_champ')),
  display_name text NOT NULL,
  display_code text,
  capacity_cap integer,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER feis_competitions_updated_at
  BEFORE UPDATE ON feis_competitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_feis_competitions_listing ON feis_competitions(feis_listing_id);

-- Expression-based unique index handles NULLs in nullable columns
-- Note: PostgREST cannot target this expression index via onConflict.
-- Bulk syllabus operations use delete-and-reinsert. Individual edits use UPDATE by primary key.
CREATE UNIQUE INDEX idx_feis_competitions_unique
  ON feis_competitions(
    feis_listing_id,
    COALESCE(age_group_key, ''),
    COALESCE(level_key, ''),
    COALESCE(dance_key, ''),
    competition_type,
    COALESCE(championship_key, '')
  );

-- ============================================================
-- 5. Seed system syllabus templates
-- ============================================================
INSERT INTO syllabus_templates (name, description, template_data, is_system) VALUES
(
  'Standard Grade Feis',
  'U6-O18, Beginner through Prizewinner. 6 solo dances. No championship.',
  '{"age_groups":[{"key":"U6","label":"Under 6","max_age_jan1":5},{"key":"U7","label":"Under 7","max_age_jan1":6},{"key":"U8","label":"Under 8","max_age_jan1":7},{"key":"U9","label":"Under 9","max_age_jan1":8},{"key":"U10","label":"Under 10","max_age_jan1":9},{"key":"U11","label":"Under 11","max_age_jan1":10},{"key":"U12","label":"Under 12","max_age_jan1":11},{"key":"U13","label":"Under 13","max_age_jan1":12},{"key":"U14","label":"Under 14","max_age_jan1":13},{"key":"U15","label":"Under 15","max_age_jan1":14},{"key":"U16","label":"Under 16","max_age_jan1":15},{"key":"U17","label":"Under 17","max_age_jan1":16},{"key":"U18","label":"Under 18","max_age_jan1":17},{"key":"O18","label":"18 & Over","min_age_jan1":18}],"levels":[{"key":"BG","label":"Beginner","rank":1},{"key":"AB","label":"Advanced Beginner","rank":2},{"key":"NOV","label":"Novice","rank":3},{"key":"PW","label":"Prizewinner","rank":4}],"dances":[{"key":"reel","label":"Reel","type":"light"},{"key":"light_jig","label":"Light Jig","type":"light"},{"key":"slip_jig","label":"Slip Jig","type":"light"},{"key":"single_jig","label":"Single Jig","type":"light"},{"key":"treble_jig","label":"Treble Jig","type":"heavy"},{"key":"hornpipe","label":"Hornpipe","type":"heavy"}],"championship_types":[],"specials":[]}'::jsonb
),
(
  'Championship Feis',
  'All of Standard Grade plus Preliminary and Open Championship.',
  '{"age_groups":[{"key":"U6","label":"Under 6","max_age_jan1":5},{"key":"U7","label":"Under 7","max_age_jan1":6},{"key":"U8","label":"Under 8","max_age_jan1":7},{"key":"U9","label":"Under 9","max_age_jan1":8},{"key":"U10","label":"Under 10","max_age_jan1":9},{"key":"U11","label":"Under 11","max_age_jan1":10},{"key":"U12","label":"Under 12","max_age_jan1":11},{"key":"U13","label":"Under 13","max_age_jan1":12},{"key":"U14","label":"Under 14","max_age_jan1":13},{"key":"U15","label":"Under 15","max_age_jan1":14},{"key":"U16","label":"Under 16","max_age_jan1":15},{"key":"U17","label":"Under 17","max_age_jan1":16},{"key":"U18","label":"Under 18","max_age_jan1":17},{"key":"U19","label":"Under 19","max_age_jan1":18},{"key":"O18","label":"18 & Over","min_age_jan1":18},{"key":"O21","label":"21 & Over","min_age_jan1":21}],"levels":[{"key":"BG","label":"Beginner","rank":1},{"key":"AB","label":"Advanced Beginner","rank":2},{"key":"NOV","label":"Novice","rank":3},{"key":"PW","label":"Prizewinner","rank":4}],"dances":[{"key":"reel","label":"Reel","type":"light"},{"key":"light_jig","label":"Light Jig","type":"light"},{"key":"slip_jig","label":"Slip Jig","type":"light"},{"key":"single_jig","label":"Single Jig","type":"light"},{"key":"treble_jig","label":"Treble Jig","type":"heavy"},{"key":"hornpipe","label":"Hornpipe","type":"heavy"},{"key":"st_patricks_day","label":"St. Patricks Day","type":"set"},{"key":"treble_reel","label":"Treble Reel","type":"heavy"}],"championship_types":[{"key":"prelim","label":"Preliminary Championship","eligible_levels":["PW"],"fee_category":"prelim_champ"},{"key":"open","label":"Open Championship","eligible_levels":["PW"],"requires_championship_status":true,"fee_category":"open_champ"}],"specials":[{"key":"ceili","label":"Ceili (Team)","type":"team"},{"key":"figure","label":"Figure Choreography","type":"team"}]}'::jsonb
),
(
  'Full CLRG',
  'All age groups, all levels, all dances, both championship types, ceili, and figure.',
  '{"age_groups":[{"key":"U6","label":"Under 6","max_age_jan1":5},{"key":"U7","label":"Under 7","max_age_jan1":6},{"key":"U8","label":"Under 8","max_age_jan1":7},{"key":"U9","label":"Under 9","max_age_jan1":8},{"key":"U10","label":"Under 10","max_age_jan1":9},{"key":"U11","label":"Under 11","max_age_jan1":10},{"key":"U12","label":"Under 12","max_age_jan1":11},{"key":"U13","label":"Under 13","max_age_jan1":12},{"key":"U14","label":"Under 14","max_age_jan1":13},{"key":"U15","label":"Under 15","max_age_jan1":14},{"key":"U16","label":"Under 16","max_age_jan1":15},{"key":"U17","label":"Under 17","max_age_jan1":16},{"key":"U18","label":"Under 18","max_age_jan1":17},{"key":"U19","label":"Under 19","max_age_jan1":18},{"key":"O18","label":"18 & Over","min_age_jan1":18},{"key":"O21","label":"21 & Over","min_age_jan1":21}],"levels":[{"key":"BG","label":"Beginner","rank":1},{"key":"AB","label":"Advanced Beginner","rank":2},{"key":"NOV","label":"Novice","rank":3},{"key":"PW","label":"Prizewinner","rank":4}],"dances":[{"key":"reel","label":"Reel","type":"light"},{"key":"light_jig","label":"Light Jig","type":"light"},{"key":"slip_jig","label":"Slip Jig","type":"light"},{"key":"single_jig","label":"Single Jig","type":"light"},{"key":"treble_jig","label":"Treble Jig","type":"heavy"},{"key":"hornpipe","label":"Hornpipe","type":"heavy"},{"key":"st_patricks_day","label":"St. Patricks Day","type":"set"},{"key":"treble_reel","label":"Treble Reel","type":"heavy"}],"championship_types":[{"key":"prelim","label":"Preliminary Championship","eligible_levels":["PW"],"fee_category":"prelim_champ"},{"key":"open","label":"Open Championship","eligible_levels":["PW"],"requires_championship_status":true,"fee_category":"open_champ"}],"specials":[{"key":"ceili","label":"Ceili (Team)","type":"team"},{"key":"figure","label":"Figure Choreography","type":"team"}]}'::jsonb
);

-- ============================================================
-- 6. Row Level Security
-- ============================================================
ALTER TABLE feis_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE syllabus_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE feis_competitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Organisers manage own listings" ON feis_listings
  FOR ALL USING (auth.uid() = created_by);
CREATE POLICY "Public can view open listings" ON feis_listings
  FOR SELECT USING (status = 'open');

CREATE POLICY "Fee schedules follow listing" ON fee_schedules
  FOR ALL USING (feis_listing_id IN (SELECT id FROM feis_listings WHERE created_by = auth.uid()));
CREATE POLICY "Public fee schedules for open listings" ON fee_schedules
  FOR SELECT USING (feis_listing_id IN (SELECT id FROM feis_listings WHERE status = 'open'));

CREATE POLICY "System templates visible to all" ON syllabus_templates
  FOR SELECT USING (is_system = true);
CREATE POLICY "Users manage own templates" ON syllabus_templates
  FOR ALL USING (created_by = auth.uid());

CREATE POLICY "Competitions follow listing" ON feis_competitions
  FOR ALL USING (feis_listing_id IN (SELECT id FROM feis_listings WHERE created_by = auth.uid()));
CREATE POLICY "Public competitions for open listings" ON feis_competitions
  FOR SELECT USING (feis_listing_id IN (SELECT id FROM feis_listings WHERE status = 'open'));

-- BRIDGE NOTE (sub-project 3): feis_listings will gain an event_id FK
-- linking to the Phase 1 events table. The bridge owns that migration.
