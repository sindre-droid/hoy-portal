-- Migration: add poweroffice_customer_id to assignment_numbers
-- Run in Supabase SQL Editor.
--
-- assignment_numbers har allerede poweroffice_synced, poweroffice_synced_at,
-- poweroffice_project_id (fra schema.sql). Vi trenger i tillegg customer_id
-- for å støtte gjenbruk av kunde ved gjentatt sync / nye oppdrag for samme selger.

ALTER TABLE assignment_numbers
  ADD COLUMN IF NOT EXISTS poweroffice_customer_id text;

COMMENT ON COLUMN assignment_numbers.poweroffice_customer_id IS
  'PowerOffice GO Customer ID (returned from /customers POST). Brukes for å gjenbruke samme kunde ved nye oppdrag fra samme selger.';
