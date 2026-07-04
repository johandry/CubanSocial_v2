-- =============================================================
-- CubanSocial — Verification Test Event
-- Run in Supabase SQL Editor after applying the schema + seed.
-- This inserts an approved event visible on the public feed.
-- Delete it after verifying the site works.
-- =============================================================

INSERT INTO events (
  name,
  description,
  event_type,
  dance_style_ids,
  city_id,
  address,
  is_private,
  is_featured,
  organizer_name,
  organizer_contact,
  organizer_contact_type,
  start_at,
  end_at,
  cost_type,
  status,
  source
)
SELECT
  'Test Timba Night',
  'Test event to verify the CubanSocial feed is working. Delete this after confirming.',
  'studio_local',
  ARRAY[(SELECT id FROM dance_styles WHERE slug = 'timba')],
  (SELECT id FROM cities WHERE name = 'San Diego'),
  '123 Calle de Prueba, San Diego, CA',
  false,
  true,    -- auto-featured because Timba
  'CubanSocial Admin',
  '@cubansocial',
  'instagram',
  NOW() + INTERVAL '7 days',
  NOW() + INTERVAL '7 days' + INTERVAL '4 hours',
  'free',
  'approved',  -- bypass pending so it appears on the feed immediately
  'admin_direct';

-- Confirm the insert:
SELECT id, name, start_at, status, is_featured, city_id
FROM   events
WHERE  name = 'Test Timba Night';

-- =============================================================
-- Cleanup — run this once you've verified the feed:
-- =============================================================
-- DELETE FROM events WHERE name = 'Test Timba Night';
