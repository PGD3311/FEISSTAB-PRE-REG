-- 002_parent_registration.sql
-- Pre-registration: parent registration portal tables
-- Builds on 001_feis_setup.sql — requires feis_listings, feis_competitions tables

-- ─── households ───
CREATE TABLE households (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_households_user_id ON households(user_id);

-- ─── dancers ───
-- Note: 'dancers' also exists in the public schema (Phase 1 day-of).
-- These are separate tables in separate schemas. The bridge (Sub-project 3)
-- maps between them.
CREATE TABLE dancers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  date_of_birth date NOT NULL,
  gender text NOT NULL CHECK (gender IN ('female', 'male')),
  school_name text,
  tcrg_name text,
  championship_status text NOT NULL DEFAULT 'none'
    CHECK (championship_status IN ('none', 'prelim', 'open')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dancers_household_id ON dancers(household_id);
CREATE TRIGGER set_dancers_updated_at BEFORE UPDATE ON dancers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── dancer_dance_levels ───
CREATE TABLE dancer_dance_levels (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  dancer_id uuid NOT NULL REFERENCES dancers(id) ON DELETE CASCADE,
  dance_key text NOT NULL,
  level_key text NOT NULL,
  source text NOT NULL DEFAULT 'parent',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dancer_id, dance_key)
);

CREATE INDEX idx_dancer_dance_levels_dancer_id ON dancer_dance_levels(dancer_id);
CREATE TRIGGER set_dancer_dance_levels_updated_at BEFORE UPDATE ON dancer_dance_levels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── registrations ───
-- Note: 'registrations' also exists in the public schema (Phase 1 day-of).
-- These are separate tables in separate schemas. The bridge (Sub-project 3)
-- maps between them.
CREATE TABLE registrations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  feis_listing_id uuid NOT NULL REFERENCES feis_listings(id),
  household_id uuid NOT NULL REFERENCES households(id),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_payment', 'paid', 'expired', 'cancelled')),
  confirmation_number text UNIQUE,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  total_cents integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  application_fee_cents integer NOT NULL DEFAULT 0 CHECK (application_fee_cents >= 0),
  event_fee_cents integer NOT NULL DEFAULT 0 CHECK (event_fee_cents >= 0),
  is_late boolean NOT NULL DEFAULT false,
  consent_accepted_at timestamptz,
  consent_version text,
  platform_terms_version text,
  consent_ip text,
  hold_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One active registration per household per feis
CREATE UNIQUE INDEX idx_registrations_active_unique
  ON registrations (feis_listing_id, household_id)
  WHERE status NOT IN ('expired', 'cancelled');

CREATE INDEX idx_registrations_feis_listing_id ON registrations(feis_listing_id);
CREATE INDEX idx_registrations_household_id ON registrations(household_id);
CREATE INDEX idx_registrations_status ON registrations(status);
CREATE INDEX idx_registrations_hold_expires ON registrations(hold_expires_at)
  WHERE status IN ('draft', 'pending_payment') AND hold_expires_at IS NOT NULL;

CREATE TRIGGER set_registrations_updated_at BEFORE UPDATE ON registrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── registration_entries ───
CREATE TABLE registration_entries (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  registration_id uuid NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  dancer_id uuid NOT NULL REFERENCES dancers(id),
  feis_competition_id uuid NOT NULL REFERENCES feis_competitions(id),
  fee_category text NOT NULL CHECK (fee_category IN ('solo', 'prelim_champ', 'open_champ')),
  base_fee_cents integer NOT NULL CHECK (base_fee_cents >= 0),
  late_fee_cents integer NOT NULL DEFAULT 0 CHECK (late_fee_cents >= 0),
  day_of_surcharge_cents integer NOT NULL DEFAULT 0 CHECK (day_of_surcharge_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (registration_id, dancer_id, feis_competition_id)
);

CREATE INDEX idx_registration_entries_registration_id ON registration_entries(registration_id);
CREATE INDEX idx_registration_entries_feis_competition_id ON registration_entries(feis_competition_id);

-- ─── registration_snapshots ───
CREATE TABLE registration_snapshots (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  registration_id uuid NOT NULL REFERENCES registrations(id),
  snapshot_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_registration_snapshots_registration_id ON registration_snapshots(registration_id);

-- ─── RLS policies ───
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE dancers ENABLE ROW LEVEL SECURITY;
ALTER TABLE dancer_dance_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_snapshots ENABLE ROW LEVEL SECURITY;

-- households
CREATE POLICY "Users manage own household" ON households
  FOR ALL USING (auth.uid() = user_id);

-- dancers
CREATE POLICY "Users manage own dancers" ON dancers
  FOR ALL USING (
    household_id IN (SELECT id FROM households WHERE user_id = auth.uid())
  );

-- dancer_dance_levels
CREATE POLICY "Levels follow dancer access" ON dancer_dance_levels
  FOR ALL USING (
    dancer_id IN (
      SELECT d.id FROM dancers d
      JOIN households h ON d.household_id = h.id
      WHERE h.user_id = auth.uid()
    )
  );

-- registrations (parent)
CREATE POLICY "Parents manage own registrations" ON registrations
  FOR ALL USING (
    household_id IN (SELECT id FROM households WHERE user_id = auth.uid())
  );

-- registrations (organiser read-only)
CREATE POLICY "Organisers see registrations for their feiseanna" ON registrations
  FOR SELECT USING (
    feis_listing_id IN (SELECT id FROM feis_listings WHERE created_by = auth.uid())
  );

-- registration_entries (parent)
CREATE POLICY "Entries follow registration (parent)" ON registration_entries
  FOR ALL USING (
    registration_id IN (
      SELECT id FROM registrations
      WHERE household_id IN (SELECT id FROM households WHERE user_id = auth.uid())
    )
  );

-- registration_entries (organiser read-only)
CREATE POLICY "Organisers see entries for their feiseanna" ON registration_entries
  FOR SELECT USING (
    registration_id IN (
      SELECT id FROM registrations
      WHERE feis_listing_id IN (SELECT id FROM feis_listings WHERE created_by = auth.uid())
    )
  );

-- registration_snapshots
CREATE POLICY "Snapshots follow registration" ON registration_snapshots
  FOR ALL USING (
    registration_id IN (
      SELECT id FROM registrations
      WHERE household_id IN (SELECT id FROM households WHERE user_id = auth.uid())
    )
  );

-- ─── pg_cron: expire stale holds ───
-- (Requires pg_cron extension — Supabase supports this)
-- Run every minute: expire draft/pending_payment registrations past their hold window
SELECT cron.schedule(
  'expire-registration-holds',
  '* * * * *',
  $$
    UPDATE registrations
    SET status = 'expired', updated_at = now()
    WHERE status IN ('draft', 'pending_payment')
      AND hold_expires_at IS NOT NULL
      AND hold_expires_at < now();
  $$
);
