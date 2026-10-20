-- 021_approval_gate.sql
-- The approval gate: a feis is listed and takes entries only after a RunFeis admin approves it.
-- Spec: docs/2026-10-20-approval-gate.md (Decisions 1–9)
-- Re-runnable; applied by hand in the SQL editor, as postgres.

SET search_path TO pre_registration, public;

-- ─── Statuses: pending_review is a submitted feis waiting for a RunFeis admin ───
ALTER TABLE feis_listings DROP CONSTRAINT IF EXISTS feis_listings_status_check;
ALTER TABLE feis_listings ADD CONSTRAINT feis_listings_status_check
  CHECK (status IN ('draft', 'pending_review', 'open', 'closed', 'launched'));

-- ─── Approval and sanction details on the listing ───
ALTER TABLE feis_listings
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS review_note text, -- the admin's note when sent back; cleared on resubmit
  ADD COLUMN IF NOT EXISTS sanction_region text,
  ADD COLUMN IF NOT EXISTS sanction_reference text,
  ADD COLUMN IF NOT EXISTS sanction_notes text;

-- ─── Who is a RunFeis admin: read only through is_platform_admin() ───
-- Add an admin by hand: INSERT INTO pre_registration.platform_admins (user_id) VALUES ('<auth user id>');
CREATE TABLE IF NOT EXISTS platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
-- REVOKE ALL, not a list of privileges, as in 012. No policies: the API roles never touch this table.
REVOKE ALL ON platform_admins FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pre_registration, public
AS $$
  SELECT EXISTS (SELECT 1 FROM pre_registration.platform_admins WHERE user_id = auth.uid())
$$;

REVOKE ALL ON FUNCTION is_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_platform_admin() TO authenticated;

INSERT INTO platform_admins (user_id)
SELECT id FROM auth.users WHERE email = 'walshdaniel143@gmail.com'
ON CONFLICT DO NOTHING;

-- ─── Organiser details, which a feis needs before it is submitted ───
CREATE TABLE IF NOT EXISTS organiser_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  organisation text NOT NULL, -- school or committee
  region text NOT NULL,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A row of blanks is not organiser details
ALTER TABLE organiser_profiles DROP CONSTRAINT IF EXISTS organiser_profiles_details_filled;
ALTER TABLE organiser_profiles ADD CONSTRAINT organiser_profiles_details_filled
  CHECK (btrim(full_name) <> '' AND btrim(organisation) <> '' AND btrim(region) <> '');

DROP TRIGGER IF EXISTS organiser_profiles_updated_at ON organiser_profiles;
CREATE TRIGGER organiser_profiles_updated_at
  BEFORE UPDATE ON organiser_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE organiser_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON organiser_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON organiser_profiles TO authenticated;

DROP POLICY IF EXISTS "Organisers read own details" ON organiser_profiles;
CREATE POLICY "Organisers read own details" ON organiser_profiles
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Organisers add own details" ON organiser_profiles;
CREATE POLICY "Organisers add own details" ON organiser_profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Organisers update own details" ON organiser_profiles;
CREATE POLICY "Organisers update own details" ON organiser_profiles
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Platform admins read all organiser details" ON organiser_profiles;
CREATE POLICY "Platform admins read all organiser details" ON organiser_profiles
  FOR SELECT TO authenticated
  USING ((SELECT is_platform_admin()));

-- ─── The guard: what the API roles may do to a listing ───
-- Applies only to anon and authenticated. Migrations, service-role code and SECURITY DEFINER functions
-- owned by postgres (approve_listing, send_back_listing below) pass through.
-- Mirrors OWNER_TRANSITIONS in src/lib/feis-listing-states.ts.
-- Triggers fire in name order, so feis_listings_updated_at (001) has already set NEW.updated_at.
CREATE OR REPLACE FUNCTION guard_feis_listings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pre_registration, pg_temp
AS $$
DECLARE
  v_submitting boolean;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'draft'
       OR NEW.approved_at IS NOT NULL OR NEW.approved_by IS NOT NULL
       OR NEW.review_note IS NOT NULL OR NEW.submitted_at IS NOT NULL THEN
      RAISE EXCEPTION 'a new feis starts as a draft, with no submission or approval' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  v_submitting := OLD.status = 'draft' AND NEW.status = 'pending_review';

  -- The approval record is RunFeis's. A resubmit may clear the review note; the guard clears it anyway.
  IF (NEW.approved_at, NEW.approved_by) IS DISTINCT FROM (OLD.approved_at, OLD.approved_by)
     OR (NEW.review_note IS DISTINCT FROM OLD.review_note AND NOT (v_submitting AND NEW.review_note IS NULL))
     OR (NEW.submitted_at IS DISTINCT FROM OLD.submitted_at AND NOT v_submitting) THEN
    RAISE EXCEPTION 'only RunFeis changes a feis''s approval, review note or submission time' USING ERRCODE = '42501';
  END IF;

  -- The admin reviews exactly what was submitted: while pending, only a withdraw changes the listing
  IF OLD.status = 'pending_review'
     AND (to_jsonb(NEW) - 'status' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'updated_at') THEN
    RAISE EXCEPTION 'a feis waiting for approval cannot be changed; withdraw it first' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status || '>' || NEW.status) = ANY (ARRAY[
      'draft>pending_review', 'pending_review>draft', 'open>closed', 'closed>open', 'closed>launched'
    ])) THEN
      RAISE EXCEPTION 'a feis cannot move from % to %', OLD.status, NEW.status USING ERRCODE = '42501';
    END IF;

    IF OLD.status = 'closed' AND NEW.status = 'open' AND OLD.approved_at IS NULL THEN
      RAISE EXCEPTION 'only a feis RunFeis approved can reopen for entries' USING ERRCODE = '42501';
    END IF;

    IF v_submitting THEN
      IF coalesce(btrim(NEW.sanction_region), '') = '' OR coalesce(btrim(NEW.sanction_reference), '') = '' THEN
        RAISE EXCEPTION 'a feis needs its sanction region and reference before it is submitted for approval'
          USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM organiser_profiles WHERE user_id = auth.uid()) THEN
        RAISE EXCEPTION 'add your organiser details before submitting a feis for approval' USING ERRCODE = '23514';
      END IF;
      NEW.submitted_at := now();
      NEW.review_note := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_feis_listings ON feis_listings;
CREATE TRIGGER guard_feis_listings
  BEFORE INSERT OR UPDATE ON feis_listings
  FOR EACH ROW EXECUTE FUNCTION guard_feis_listings();

-- ─── Fees and syllabus are frozen with the listing while it waits for approval ───
-- The tables that hang off a listing's price and syllabus: fee_schedules and feis_competitions
-- (008 and 009 only add columns to them; 019 adds no listing-level table). Same roles as the guard above.
-- An update checks both the old and the new parent, so a row can't be moved into or out of a pending feis.
CREATE OR REPLACE FUNCTION guard_pending_listing_children()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pre_registration, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  IF EXISTS (
    SELECT 1 FROM feis_listings l
    WHERE l.status = 'pending_review'
      AND l.id IN (
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.feis_listing_id END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.feis_listing_id END
      )
  ) THEN
    RAISE EXCEPTION 'This feis is waiting for RunFeis approval. Withdraw it first to make changes.'
      USING ERRCODE = '42501';
  END IF;

  RETURN coalesce(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS guard_pending_fee_schedules ON fee_schedules;
CREATE TRIGGER guard_pending_fee_schedules
  BEFORE INSERT OR UPDATE OR DELETE ON fee_schedules
  FOR EACH ROW EXECUTE FUNCTION guard_pending_listing_children();

DROP TRIGGER IF EXISTS guard_pending_feis_competitions ON feis_competitions;
CREATE TRIGGER guard_pending_feis_competitions
  BEFORE INSERT OR UPDATE OR DELETE ON feis_competitions
  FOR EACH ROW EXECUTE FUNCTION guard_pending_listing_children();

-- ─── Admin decisions ───
CREATE OR REPLACE FUNCTION approve_listing(p_listing_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, public
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'only RunFeis admins can approve a feis' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_status FROM feis_listings WHERE id = p_listing_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no feis %', p_listing_id USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'pending_review' THEN
    RAISE EXCEPTION 'feis % is %, not waiting for approval', p_listing_id, v_status USING ERRCODE = '55000';
  END IF;

  UPDATE feis_listings
  SET status = 'open', approved_at = now(), approved_by = auth.uid(), review_note = NULL
  WHERE id = p_listing_id;

  RETURN p_listing_id;
END;
$$;

CREATE OR REPLACE FUNCTION send_back_listing(p_listing_id uuid, p_note text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, public
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'only RunFeis admins can send back a feis' USING ERRCODE = '42501';
  END IF;
  IF coalesce(btrim(p_note), '') = '' THEN
    RAISE EXCEPTION 'a note saying what to fix is required' USING ERRCODE = '22023';
  END IF;

  SELECT status INTO v_status FROM feis_listings WHERE id = p_listing_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no feis %', p_listing_id USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'pending_review' THEN
    RAISE EXCEPTION 'feis % is %, not waiting for approval', p_listing_id, v_status USING ERRCODE = '55000';
  END IF;

  UPDATE feis_listings SET status = 'draft', review_note = p_note WHERE id = p_listing_id;

  RETURN p_listing_id;
END;
$$;

REVOKE ALL ON FUNCTION approve_listing(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION send_back_listing(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION approve_listing(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION send_back_listing(uuid, text) TO authenticated;

-- ─── Admins read every listing, with its fees and syllabus, to review it ───
DROP POLICY IF EXISTS "Platform admins read all listings" ON feis_listings;
CREATE POLICY "Platform admins read all listings" ON feis_listings
  FOR SELECT TO authenticated
  USING ((SELECT is_platform_admin()));

DROP POLICY IF EXISTS "Platform admins read all listings" ON fee_schedules;
CREATE POLICY "Platform admins read all listings" ON fee_schedules
  FOR SELECT TO authenticated
  USING ((SELECT is_platform_admin()));

DROP POLICY IF EXISTS "Platform admins read all listings" ON feis_competitions;
CREATE POLICY "Platform admins read all listings" ON feis_competitions
  FOR SELECT TO authenticated
  USING ((SELECT is_platform_admin()));

-- ─── Listings already taking (or done taking) entries are approved as they stand ───
-- Runs as postgres, so the guard doesn't apply
UPDATE feis_listings
SET approved_at = now()
WHERE status IN ('open', 'closed', 'launched') AND approved_at IS NULL;
