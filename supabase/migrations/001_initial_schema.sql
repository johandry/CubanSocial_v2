-- =============================================================
-- CubanSocial — Initial Schema
-- Migration: 001_initial_schema.sql
-- =============================================================

-- ---------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------
CREATE TYPE event_status   AS ENUM ('pending', 'approved', 'rejected', 'archived');
CREATE TYPE event_type_val AS ENUM ('studio_local', 'social_local', 'congress_national', 'congress_international');
CREATE TYPE cost_type_val  AS ENUM ('free', 'paid', 'potluck', 'tips', 'sliding_scale');
CREATE TYPE source_val     AS ENUM ('whatsapp_paste', 'whatsapp_paste_ai_assisted', 'manual_form', 'admin_direct');
CREATE TYPE notif_type_val AS ENUM ('reminder_draft', 'instagram_draft', 'admin_email');

-- ---------------------------------------------------------------
-- dance_styles
-- ---------------------------------------------------------------
CREATE TABLE dance_styles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  is_featured boolean NOT NULL DEFAULT false
);

-- ---------------------------------------------------------------
-- cities
-- ---------------------------------------------------------------
CREATE TABLE cities (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name      text NOT NULL,
  state     text NOT NULL,
  country   text NOT NULL DEFAULT 'US',
  lat       numeric(9,6) NOT NULL,
  lon       numeric(9,6) NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

-- ---------------------------------------------------------------
-- admins  (mirrors Supabase Auth users)
-- ---------------------------------------------------------------
CREATE TABLE admins (
  id           uuid PRIMARY KEY,   -- must match auth.users.id
  email        text NOT NULL,
  display_name text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- events
-- ---------------------------------------------------------------
CREATE TABLE events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,
  description          text,
  event_type           event_type_val NOT NULL,
  dance_style_ids      uuid[] NOT NULL DEFAULT '{}',
  city_id              uuid REFERENCES cities(id) ON DELETE SET NULL,
  address              text,
  is_private           boolean NOT NULL DEFAULT false,
  is_featured          boolean NOT NULL DEFAULT false,
  organizer_contact    text,
  organizer_name       text,
  media_url            text,
  external_link        text,
  start_at             timestamptz NOT NULL,
  end_at               timestamptz,
  cost_type            cost_type_val NOT NULL DEFAULT 'free',
  cost_amount          numeric(8,2),
  cost_notes           text,
  status               event_status NOT NULL DEFAULT 'pending',
  source               source_val NOT NULL DEFAULT 'manual_form',
  raw_submission_text  text,
  instagram_draft      text,
  reminder_sent_at     timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  approved_at          timestamptz,
  approved_by          uuid REFERENCES admins(id) ON DELETE SET NULL
);

CREATE INDEX idx_events_status     ON events(status);
CREATE INDEX idx_events_start_at   ON events(start_at);
CREATE INDEX idx_events_city_id    ON events(city_id);
CREATE INDEX idx_events_is_featured ON events(is_featured);

-- ---------------------------------------------------------------
-- notification_log
-- ---------------------------------------------------------------
CREATE TABLE notification_log (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  uuid REFERENCES events(id) ON DELETE CASCADE,
  type      notif_type_val NOT NULL,
  sent_at   timestamptz NOT NULL DEFAULT now(),
  content   text
);

-- ---------------------------------------------------------------
-- Row-Level Security (RLS)
-- ---------------------------------------------------------------
ALTER TABLE events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE dance_styles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cities          ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins          ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

-- Public: read approved events only
CREATE POLICY "public_read_approved_events"
  ON events FOR SELECT
  USING (status = 'approved');

-- Public: submit (insert) events — no UPDATE/DELETE
CREATE POLICY "public_insert_events"
  ON events FOR INSERT
  WITH CHECK (status = 'pending');

-- Admins: full CRUD via service role (handled by Edge Functions / dashboard)
-- (service role bypasses RLS — no additional policy needed)

-- Public: read dance_styles
CREATE POLICY "public_read_dance_styles"
  ON dance_styles FOR SELECT
  USING (true);

-- Public: read active cities
CREATE POLICY "public_read_cities"
  ON cities FOR SELECT
  USING (is_active = true);

-- Admins: read own row
CREATE POLICY "admins_read_own"
  ON admins FOR SELECT
  USING (auth.uid() = id);

-- ---------------------------------------------------------------
-- pg_cron: auto-archive past events (daily at 00:05 UTC)
-- Requires pg_cron extension enabled in Supabase dashboard
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
