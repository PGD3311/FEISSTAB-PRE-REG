-- 019_add_on_orders.sql
-- A family can come back after paying and add dances or dancers, paying only for what's new.
-- Each visit is its own registration (order): any number can be paid, but only one can be
-- unpaid at a time, so a family never has two open checkouts for the same feis.
-- The same dancer can't be entered in the same competition twice across orders; the app checks
-- this before creating an order.
-- Matches the add-on model in the payment-hardening design ("Changes After Paying").

SET search_path TO pre_registration, public;

DROP INDEX IF EXISTS idx_registrations_active_unique;

CREATE UNIQUE INDEX idx_registrations_active_unique
  ON registrations (feis_listing_id, household_id)
  WHERE status IN ('draft', 'pending_payment');
