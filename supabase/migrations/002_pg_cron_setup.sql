-- =============================================================
-- CubanSocial — pg_cron Jobs Setup
-- Migration: 002_pg_cron_setup.sql
-- =============================================================
-- Prerequisites (do these in the Supabase dashboard FIRST):
--   1. Database → Extensions → enable pg_cron
--   2. Run 001_initial_schema.sql successfully
--
-- Run this file in the Supabase SQL Editor.
--
-- For the Slice 5 reminder job you will also need:
--   Database → Extensions → enable pg_net
-- =============================================================

-- ---------------------------------------------------------------
-- Auto-archive events more than 60 days past their start date.
-- Runs daily at 00:05 UTC as pure SQL (no Edge Function needed).
-- ---------------------------------------------------------------
SELECT cron.schedule(
  'auto-archive-events',
  '5 0 * * *',
  $$
    UPDATE events
    SET status = 'archived'
    WHERE status = 'approved'
      AND COALESCE(end_at, start_at) < NOW() - INTERVAL '60 days';
  $$
);

-- ---------------------------------------------------------------
-- WhatsApp Reminder Draft Job (Slice 5 — add when ready)
-- ---------------------------------------------------------------
-- Requires: pg_net extension enabled + send-reminder Edge Function deployed.
-- Calls the Edge Function daily at 09:00 UTC; the function finds events
-- starting in 3 days with reminder_sent_at IS NULL and emails admins.
--
-- Before enabling, set these Postgres settings (run once):
--   ALTER DATABASE postgres
--     SET app.supabase_url = 'https://<project-ref>.supabase.co';
--   ALTER DATABASE postgres
--     SET app.service_role_key = '<service-role-key>';
--
-- SELECT cron.schedule(
--   'send-reminder-drafts',
--   '0 9 * * *',
--   $$
--     SELECT net.http_post(
--       url     := current_setting('app.supabase_url') || '/functions/v1/send-reminder',
--       headers := jsonb_build_object(
--         'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
--         'Content-Type',  'application/json'
--       ),
--       body    := '{}'::jsonb
--     );
--   $$
-- );

-- ---------------------------------------------------------------
-- Recurring Event Generation Job (Slice 5 — add when ready)
-- ---------------------------------------------------------------
-- Runs every Sunday at 08:00 UTC; extends recurring series so they
-- always have 12 weeks of upcoming instances.
--
-- SELECT cron.schedule(
--   'generate-recurrences',
--   '0 8 * * 0',
--   $$
--     SELECT net.http_post(
--       url     := current_setting('app.supabase_url') || '/functions/v1/generate-recurrences',
--       headers := jsonb_build_object(
--         'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
--         'Content-Type',  'application/json'
--       ),
--       body    := '{}'::jsonb
--     );
--   $$
-- );
