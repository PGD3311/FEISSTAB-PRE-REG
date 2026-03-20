-- Phase 1: Bridge hardening migration
-- Run this in the Phase 1 Supabase project (acxyvouzwgvobtbmvoej)
-- These columns enable upsert idempotency so the bridge can be safely re-run.

-- External ID columns: link Phase 1 rows back to their pre-reg source
ALTER TABLE events ADD COLUMN IF NOT EXISTS prereg_feis_listing_id text UNIQUE;
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS prereg_feis_competition_id text UNIQUE;
ALTER TABLE dancers ADD COLUMN IF NOT EXISTS prereg_dancer_id text UNIQUE;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS prereg_registration_entry_id text UNIQUE;

-- Import status tracking on events
ALTER TABLE events ADD COLUMN IF NOT EXISTS import_status text DEFAULT 'ready'
  CHECK (import_status IN ('importing', 'ready', 'partial_failed'));
ALTER TABLE events ADD COLUMN IF NOT EXISTS import_error text;
