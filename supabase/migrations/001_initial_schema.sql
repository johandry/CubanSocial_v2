-- =============================================================
-- CubanSocial — Initial Schema  v1.2
-- Migration: 001_initial_schema.sql
-- =============================================================
-- Prerequisites:
--   Apply this file first (Supabase SQL Editor or `supabase db push`).
--   pg_cron jobs live in 002_pg_cron_setup.sql — apply that AFTER
--   enabling the pg_cron extension in the Supabase dashboard.
-- =============================================================

-- ---------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------
CREATE TYPE event_status               AS ENUM ('pending', 'approved', 'rejected', 'archived', 'cancelled');
-- 'cancelled' is used only on individual child instances of recurring events.

CREATE TYPE event_type_val             AS ENUM ('studio_local', 'social_local', 'congress_national', 'congress_international');
CREATE TYPE cost_type_val              AS ENUM ('free', 'paid', 'potluck', 'tips', 'sliding_scale');
CREATE TYPE source_val                 AS ENUM ('whatsapp_paste', 'whatsapp_paste_ai_assisted', 'manual_form', 'admin_direct');
CREATE TYPE notif_type_val             AS ENUM ('reminder_draft', 'instagram_draft', 'admin_email');
CREATE TYPE organizer_contact_type_val AS ENUM ('instagram', 'whatsapp', 'email', 'other');
CREATE TYPE recurrence_type_val        AS ENUM ('none', 'weekly', 'biweekly', 'monthly');

-- ---------------------------------------------------------------
-- dance_styles
-- ---------------------------------------------------------------
CREATE TABLE dance_styles (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text    NOT NULL,
  slug        text    NOT NULL UNIQUE,
  is_featured boolean NOT NULL DEFAULT false
);

-- ---------------------------------------------------------------
-- cities
-- ---------------------------------------------------------------
CREATE TABLE cities (
  id        uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  name      text         NOT NULL,
  state     text         NOT NULL,
  country   text         NOT NULL DEFAULT 'US',
  lat       numeric(9,6) NOT NULL,
  lon       numeric(9,6) NOT NULL,
  is_active boolean      NOT NULL DEFAULT true
);

-- ---------------------------------------------------------------
-- admins  (mirrors Supabase Auth users)
-- ---------------------------------------------------------------
CREATE TABLE admins (
  id           uuid        PRIMARY KEY,   -- must match auth.users.id
  email        text        NOT NULL,
  display_name text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- events
-- NOTE: parent_event_id (self-referential FK) is added via
--       ALTER TABLE below to avoid forward-reference issues.
-- ---------------------------------------------------------------
CREATE TABLE events (
  id                     uuid                   PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text                   NOT NULL,
  description            text,
  event_type             event_type_val         NOT NULL,
  dance_style_ids        uuid[]                 NOT NULL DEFAULT '{}',
  city_id                uuid                   REFERENCES cities(id) ON DELETE SET NULL,
  address                text,                  -- null when is_private = true
  is_private             boolean                NOT NULL DEFAULT false,
  is_featured            boolean                NOT NULL DEFAULT false,
  organizer_name         text,
  organizer_contact      text,                  -- handle or number, e.g. '@user' or '+16195550123'
  organizer_contact_type organizer_contact_type_val NOT NULL DEFAULT 'other',
  media_url              text,                  -- direct image URL or social post link
  external_link          text,                  -- ticketing page or external listing
  start_at               timestamptz            NOT NULL,
  end_at                 timestamptz,
  cost_type              cost_type_val          NOT NULL DEFAULT 'free',
  cost_amount            numeric(8,2),
  cost_notes             text,                  -- shown as (?) tooltip next to cost badge
  status                 event_status           NOT NULL DEFAULT 'pending',
  source                 source_val             NOT NULL DEFAULT 'manual_form',
  raw_submission_text    text,                  -- original pasted text (audit)
  instagram_draft        text,                  -- auto-generated on approval
  reminder_sent_at       timestamptz,           -- null until reminder email dispatched
  recurrence_type        recurrence_type_val    NOT NULL DEFAULT 'none',
  recurrence_end_at      timestamptz,           -- null = auto-generate 12 weeks ahead
  parent_event_id        uuid,                  -- FK added below (self-referential)
  created_at             timestamptz            NOT NULL DEFAULT now(),
  approved_at            timestamptz,
  approved_by            uuid                   REFERENCES admins(id) ON DELETE SET NULL
);

-- Self-referential FK: child recurring instances point to their parent event row
ALTER TABLE events
  ADD CONSTRAINT events_parent_event_id_fkey
  FOREIGN KEY (parent_event_id) REFERENCES events(id) ON DELETE SET NULL;

-- Indexes for common query patterns
CREATE INDEX idx_events_status      ON events(status);
CREATE INDEX idx_events_start_at    ON events(start_at);
CREATE INDEX idx_events_city_id     ON events(city_id);
CREATE INDEX idx_events_is_featured ON events(is_featured);
CREATE INDEX idx_events_parent_id   ON events(parent_event_id) WHERE parent_event_id IS NOT NULL;
CREATE INDEX idx_events_recurrence  ON events(recurrence_type)  WHERE recurrence_type != 'none';

-- ---------------------------------------------------------------
-- notification_log  (audit trail for emails + drafts)
-- ---------------------------------------------------------------
CREATE TABLE notification_log (
  id       uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid           REFERENCES events(id) ON DELETE CASCADE,
  type     notif_type_val NOT NULL,
  sent_at  timestamptz    NOT NULL DEFAULT now(),
  content  text
);

-- ---------------------------------------------------------------
-- Row-Level Security (RLS)
-- ---------------------------------------------------------------
ALTER TABLE events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE dance_styles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cities           ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins           ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

-- Public: read only approved events (cancelled + archived are automatically excluded)
CREATE POLICY "public_read_approved_events"
  ON events FOR SELECT
  USING (status = 'approved');

-- Public: submit new events — INSERT only, status must be 'pending'
CREATE POLICY "public_insert_events"
  ON events FOR INSERT
  WITH CHECK (status = 'pending');

-- Admins use the service role key via Edge Functions; service role bypasses RLS entirely.

-- Public: read dance_styles (needed to populate filters + parser)
CREATE POLICY "public_read_dance_styles"
  ON dance_styles FOR SELECT
  USING (true);

-- Public: read active cities (needed for geolocation + city dropdown)
CREATE POLICY "public_read_cities"
  ON cities FOR SELECT
  USING (is_active = true);

-- Admins: may read only their own row
CREATE POLICY "admins_read_own"
  ON admins FOR SELECT
  USING (auth.uid() = id);
