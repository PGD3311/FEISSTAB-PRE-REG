-- 004_bridge_launched_state.sql
-- Add launched state support to feis_listings

SET search_path TO pre_registration, public;

-- Add new columns for bridge tracking
ALTER TABLE feis_listings ADD COLUMN IF NOT EXISTS launched_at timestamptz;
ALTER TABLE feis_listings ADD COLUMN IF NOT EXISTS launched_event_id text;

-- Update the status check constraint to include 'launched'
ALTER TABLE feis_listings DROP CONSTRAINT IF EXISTS feis_listings_status_check;
ALTER TABLE feis_listings ADD CONSTRAINT feis_listings_status_check
  CHECK (status IN ('draft', 'open', 'closed', 'launched'));
