-- 018_schools_and_guests.sql
-- * A shared list of Irish dance schools that families search when adding a dancer, and add to
--   when theirs is missing (the list grows as families sign up).
-- * Each dancer records whether they are part of the account holder's household or a guest
--   (someone else's child the account holder enters, as FeisWeb allows).
-- dancers.school_name stays the stored name that entries, emails and the feis-day bridge read;
-- school_id links it to the list.
-- Numbered 018 so it doesn't clash with the payment-hardening migrations (012 to 017).

SET search_path TO pre_registration, public;

CREATE TABLE IF NOT EXISTS schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  -- Lower-case, single-spaced name, so "Murphy  Academy" and "murphy academy" are the same school
  name_key text GENERATED ALWAYS AS (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) STORED,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS schools_name_key_unique ON schools(name_key);

ALTER TABLE schools ENABLE ROW LEVEL SECURITY;

-- Any signed-in family or organiser can search the list
DROP POLICY IF EXISTS "Signed-in users read schools" ON schools;
CREATE POLICY "Signed-in users read schools" ON schools
  FOR SELECT TO authenticated USING (true);

-- Families add a missing school, recorded as theirs; nobody edits or deletes through the app
DROP POLICY IF EXISTS "Signed-in users add schools" ON schools;
CREATE POLICY "Signed-in users add schools" ON schools
  FOR INSERT TO authenticated WITH CHECK (created_by = (SELECT auth.uid()));

GRANT SELECT, INSERT ON schools TO authenticated;

ALTER TABLE dancers
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES schools(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS relationship text NOT NULL DEFAULT 'household'
    CHECK (relationship IN ('household', 'guest'));

CREATE INDEX IF NOT EXISTS idx_dancers_school_id ON dancers(school_id);

-- Start the list with the schools families have already typed in
INSERT INTO schools (name, created_by)
SELECT DISTINCT ON (lower(regexp_replace(btrim(school_name), '\s+', ' ', 'g'))) btrim(school_name), NULL
FROM dancers
WHERE school_name IS NOT NULL AND char_length(btrim(school_name)) BETWEEN 2 AND 120
ON CONFLICT (name_key) DO NOTHING;

UPDATE dancers d
SET school_id = s.id
FROM schools s
WHERE d.school_id IS NULL
  AND d.school_name IS NOT NULL
  AND s.name_key = lower(regexp_replace(btrim(d.school_name), '\s+', ' ', 'g'));
