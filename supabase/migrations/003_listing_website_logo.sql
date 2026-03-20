-- 003_listing_website_logo.sql
-- Add website_url and logo_url to feis_listings for homepage display

ALTER TABLE feis_listings ADD COLUMN IF NOT EXISTS website_url text;
ALTER TABLE feis_listings ADD COLUMN IF NOT EXISTS logo_url text;
