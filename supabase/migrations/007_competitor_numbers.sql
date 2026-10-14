-- 007_competitor_numbers.sql
-- Competitor numbers are assigned at registration, in the order registrations
-- are paid, so cards can be printed before the feis (101, 102, ... per feis).
-- A family's dancers get a consecutive block. A dancer keeps one number per feis.

SET search_path TO pre_registration, public;

ALTER TABLE feis_listings
  ADD COLUMN IF NOT EXISTS first_competitor_number integer NOT NULL DEFAULT 101
  CHECK (first_competitor_number > 0);

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS paid_at timestamptz;

CREATE TABLE competitor_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feis_listing_id uuid NOT NULL REFERENCES feis_listings(id) ON DELETE CASCADE,
  dancer_id uuid NOT NULL REFERENCES dancers(id),
  registration_id uuid NOT NULL REFERENCES registrations(id),
  competitor_number integer NOT NULL CHECK (competitor_number > 0),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (feis_listing_id, competitor_number),
  UNIQUE (feis_listing_id, dancer_id)
);

CREATE INDEX idx_competitor_numbers_registration_id ON competitor_numbers(registration_id);
CREATE INDEX idx_competitor_numbers_dancer_id ON competitor_numbers(dancer_id);

ALTER TABLE competitor_numbers ENABLE ROW LEVEL SECURITY;

-- Read-only for clients; numbers are only written by the functions below.
CREATE POLICY "Parents see own dancers' numbers" ON competitor_numbers
  FOR SELECT USING (
    dancer_id IN (
      SELECT d.id FROM dancers d
      JOIN households h ON d.household_id = h.id
      WHERE h.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Organisers see numbers for own listings" ON competitor_numbers
  FOR SELECT USING (
    feis_listing_id IN (
      SELECT id FROM feis_listings WHERE created_by = (SELECT auth.uid())
    )
  );

-- Internal: assigns numbers to every dancer in one paid registration who doesn't
-- have one yet for that feis. Caller must hold the feis_listings row lock.
CREATE OR REPLACE FUNCTION _assign_numbers_for_registration(p_registration_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, public
AS $$
DECLARE
  v_listing_id uuid;
  v_next integer;
  v_assigned integer := 0;
  v_dancer record;
BEGIN
  SELECT r.feis_listing_id INTO v_listing_id
  FROM registrations r
  WHERE r.id = p_registration_id AND r.status = 'paid';

  IF v_listing_id IS NULL THEN
    RAISE EXCEPTION 'registration % is not paid', p_registration_id;
  END IF;

  SELECT greatest(
    (SELECT first_competitor_number FROM feis_listings WHERE id = v_listing_id),
    coalesce(max(competitor_number) + 1, 0)
  ) INTO v_next
  FROM competitor_numbers
  WHERE feis_listing_id = v_listing_id;

  FOR v_dancer IN
    SELECT d.id
    FROM dancers d
    WHERE d.id IN (
      SELECT e.dancer_id FROM registration_entries e WHERE e.registration_id = p_registration_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM competitor_numbers c
      WHERE c.feis_listing_id = v_listing_id AND c.dancer_id = d.id
    )
    ORDER BY d.created_at, d.last_name, d.first_name, d.id
  LOOP
    INSERT INTO competitor_numbers (feis_listing_id, dancer_id, registration_id, competitor_number)
    VALUES (v_listing_id, v_dancer.id, p_registration_id, v_next);
    v_next := v_next + 1;
    v_assigned := v_assigned + 1;
  END LOOP;

  RETURN v_assigned;
END;
$$;

REVOKE ALL ON FUNCTION _assign_numbers_for_registration(uuid) FROM PUBLIC, anon, authenticated;

-- Called by the Stripe webhook (service role) as soon as a registration is paid.
-- Idempotent: dancers who already have a number are skipped.
CREATE OR REPLACE FUNCTION assign_competitor_numbers(p_registration_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, public
AS $$
DECLARE
  v_listing_id uuid;
BEGIN
  SELECT feis_listing_id INTO v_listing_id FROM registrations WHERE id = p_registration_id;
  IF v_listing_id IS NULL THEN
    RAISE EXCEPTION 'registration % not found', p_registration_id;
  END IF;

  -- Serialise number assignment per feis
  PERFORM 1 FROM feis_listings WHERE id = v_listing_id FOR UPDATE;

  RETURN _assign_numbers_for_registration(p_registration_id);
END;
$$;

REVOKE ALL ON FUNCTION assign_competitor_numbers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION assign_competitor_numbers(uuid) TO service_role;

-- Safety net run by the organiser before launch: numbers any paid registration
-- the webhook missed, in payment order.
CREATE OR REPLACE FUNCTION assign_missing_competitor_numbers(p_feis_listing_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pre_registration, public
AS $$
DECLARE
  v_reg record;
  v_assigned integer := 0;
BEGIN
  PERFORM 1 FROM feis_listings
  WHERE id = p_feis_listing_id AND created_by = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing not found or not authorised';
  END IF;

  FOR v_reg IN
    SELECT r.id
    FROM registrations r
    WHERE r.feis_listing_id = p_feis_listing_id AND r.status = 'paid'
    ORDER BY coalesce(r.paid_at, r.updated_at), r.id
  LOOP
    v_assigned := v_assigned + _assign_numbers_for_registration(v_reg.id);
  END LOOP;

  RETURN v_assigned;
END;
$$;

REVOKE ALL ON FUNCTION assign_missing_competitor_numbers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION assign_missing_competitor_numbers(uuid) TO authenticated;
