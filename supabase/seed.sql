-- =============================================================
-- CubanSocial — Seed Data
-- Run after 001_initial_schema.sql
-- =============================================================

-- ---------------------------------------------------------------
-- Dance Styles
-- ---------------------------------------------------------------
INSERT INTO dance_styles (name, slug, is_featured) VALUES
  ('Timba',        'timba',         true),
  ('Salsa (On1)',  'salsa-on1',     false),
  ('Salsa (On2)',  'salsa-on2',     false),
  ('Bachata',      'bachata',       false),
  ('Merengue',     'merengue',      false),
  ('Cumbia',       'cumbia',        false),
  ('Cha-cha-chá',  'cha-cha-cha',   false),
  ('Mambo',        'mambo',         false),
  ('Kizomba',      'kizomba',       false),
  ('Reggaeton',    'reggaeton',     false),
  ('Guaracha',     'guaracha',      false),
  ('Son Cubano',   'son-cubano',    false);

-- ---------------------------------------------------------------
-- Initial City Coverage — California
-- ---------------------------------------------------------------
INSERT INTO cities (name, state, lat, lon) VALUES
  ('San Diego',      'CA',  32.7157,  -117.1611),
  ('Los Angeles',    'CA',  34.0522,  -118.2437),
  ('San Francisco',  'CA',  37.7749,  -122.4194),
  ('San Jose',       'CA',  37.3382,  -121.8863),
  ('Sacramento',     'CA',  38.5816,  -121.4944),
  ('Orange County',  'CA',  33.7175,  -117.8311),
  ('Riverside',      'CA',  33.9806,  -117.3755),
  ('Palm Springs',   'CA',  33.8303,  -116.5453);
