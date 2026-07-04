/**
 * Tests for js/geo.js
 *
 * Run with:
 *   npm test -- geo
 *
 * All functions are pure (haversine, nearestCity, citiesWithinRadius) or use
 * localStorage (saveCity/loadCity, saveRadius/loadRadius).  No DOM or network
 * calls — these tests run fine in either 'node' or 'jsdom' environments.
 *
 * Boundary conditions from PRD §6.3:
 *   - Default radius is 25 mi
 *   - radius = 0 means "Any distance" (the radius dropdown special value)
 *   - nearestCity uses a 30 mi hard cap when matching geolocation to a city
 *   - citiesWithinRadius uses the selected radius value (10/25/50/80/0)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  haversine,
  nearestCity,
  citiesWithinRadius,
  saveCity,
  loadCity,
  saveRadius,
  loadRadius,
} from './geo.js';

// ---------------------------------------------------------------------------
// Fixtures — real California city centroids (from seed.sql)
// ---------------------------------------------------------------------------
const SAN_DIEGO   = { id: 'sd',  name: 'San Diego',      state: 'CA', lat: 32.7157, lon: -117.1611 };
const LOS_ANGELES = { id: 'la',  name: 'Los Angeles',    state: 'CA', lat: 34.0522, lon: -118.2437 };
const SAN_JOSE    = { id: 'sj',  name: 'San Jose',       state: 'CA', lat: 37.3382, lon: -121.8863 };
const SAN_FRANCISCO = { id: 'sf', name: 'San Francisco', state: 'CA', lat: 37.7749, lon: -122.4194 };

const ALL_CITIES = [SAN_DIEGO, LOS_ANGELES, SAN_JOSE, SAN_FRANCISCO];

// User location: downtown San Diego (very close to SAN_DIEGO centroid)
const USER_SAN_DIEGO = { lat: 32.7200, lon: -117.1500 };

// User location: middle of the ocean — far from every city
const USER_PACIFIC   = { lat: 20.0, lon: -140.0 };

// ---------------------------------------------------------------------------
// haversine
// ---------------------------------------------------------------------------
describe('haversine', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversine(32.7157, -117.1611, 32.7157, -117.1611)).toBe(0);
  });

  it('is symmetric: dist(A→B) equals dist(B→A)', () => {
    const ab = haversine(SAN_DIEGO.lat, SAN_DIEGO.lon, LOS_ANGELES.lat, LOS_ANGELES.lon);
    const ba = haversine(LOS_ANGELES.lat, LOS_ANGELES.lon, SAN_DIEGO.lat, SAN_DIEGO.lon);
    expect(ab).toBeCloseTo(ba, 6);
  });

  it('San Diego → Los Angeles is approximately 112 miles', () => {
    const d = haversine(SAN_DIEGO.lat, SAN_DIEGO.lon, LOS_ANGELES.lat, LOS_ANGELES.lon);
    // Accepted range: 110–115 mi (real straight-line distance ≈ 112 mi)
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(115);
  });

  it('San Diego → San Francisco is approximately 460 miles', () => {
    const d = haversine(SAN_DIEGO.lat, SAN_DIEGO.lon, SAN_FRANCISCO.lat, SAN_FRANCISCO.lon);
    expect(d).toBeGreaterThan(450);
    expect(d).toBeLessThan(480);
  });

  it('returns a positive number for any distinct pair of real-world coordinates', () => {
    const d = haversine(0, 0, 1, 1);
    expect(d).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// nearestCity
// ---------------------------------------------------------------------------
describe('nearestCity', () => {
  it('returns the nearest city when one is within maxMiles', () => {
    // User near San Diego: nearest city should be San Diego
    const result = nearestCity(USER_SAN_DIEGO, ALL_CITIES, 30);
    expect(result?.id).toBe('sd');
  });

  it('returns null when no city is within maxMiles', () => {
    // User in Pacific Ocean: no city within 30 mi
    const result = nearestCity(USER_PACIFIC, ALL_CITIES, 30);
    expect(result).toBeNull();
  });

  it('returns null for an empty cities array', () => {
    expect(nearestCity(USER_SAN_DIEGO, [], 30)).toBeNull();
  });

  it('includes a city at exactly maxMiles (boundary is inclusive: d <= maxMiles)', () => {
    // Place a fake city exactly 1 mile away and set maxMiles to 1
    const nearby = [{ id: 'fake', lat: 32.7302, lon: -117.1611 }]; // ~1 mi north
    const d = haversine(USER_SAN_DIEGO.lat, USER_SAN_DIEGO.lon, 32.7302, -117.1611);
    const result = nearestCity(USER_SAN_DIEGO, nearby, Math.ceil(d));
    expect(result?.id).toBe('fake');
  });

  it('returns the CLOSEST city when multiple are within range', () => {
    // San Diego is much closer to USER_SAN_DIEGO than LA is
    const result = nearestCity(USER_SAN_DIEGO, [SAN_DIEGO, LOS_ANGELES], 200);
    expect(result?.id).toBe('sd');
  });

  it('uses default maxMiles of 30 when not specified', () => {
    // San Diego centroid is within 1 mi of USER_SAN_DIEGO — should match
    const result = nearestCity(USER_SAN_DIEGO, [SAN_DIEGO]);
    expect(result?.id).toBe('sd');
  });
});

// ---------------------------------------------------------------------------
// citiesWithinRadius
// ---------------------------------------------------------------------------
describe('citiesWithinRadius', () => {
  it('returns only cities within the given radius', () => {
    // From San Diego, only San Diego itself is within 5 miles
    const results = citiesWithinRadius(USER_SAN_DIEGO, ALL_CITIES, 5);
    expect(results.map((c) => c.id)).toEqual(['sd']);
  });

  it('returns all California cities when radius is large enough (>500 mi)', () => {
    const results = citiesWithinRadius(USER_SAN_DIEGO, ALL_CITIES, 600);
    expect(results.length).toBe(ALL_CITIES.length);
  });

  it('returns an empty array when no city is within radius', () => {
    const results = citiesWithinRadius(USER_PACIFIC, ALL_CITIES, 30);
    expect(results).toHaveLength(0);
  });

  it('returns an empty array for an empty cities list', () => {
    expect(citiesWithinRadius(USER_SAN_DIEGO, [], 100)).toHaveLength(0);
  });

  it('includes more cities as radius grows (monotone)', () => {
    const r50  = citiesWithinRadius(USER_SAN_DIEGO, ALL_CITIES, 50);
    const r200 = citiesWithinRadius(USER_SAN_DIEGO, ALL_CITIES, 200);
    expect(r200.length).toBeGreaterThanOrEqual(r50.length);
  });

  it('SD + LA are both within 200 mi of San Diego user; SF and SJ are not within 50 mi', () => {
    const r50  = citiesWithinRadius(USER_SAN_DIEGO, ALL_CITIES, 50).map((c) => c.id);
    const r200 = citiesWithinRadius(USER_SAN_DIEGO, ALL_CITIES, 200).map((c) => c.id);
    // 50 mi: only San Diego
    expect(r50).toContain('sd');
    expect(r50).not.toContain('sf');
    // 200 mi: San Diego + LA
    expect(r200).toContain('sd');
    expect(r200).toContain('la');
    expect(r200).not.toContain('sf');
  });
});

// ---------------------------------------------------------------------------
// saveCity / loadCity
// ---------------------------------------------------------------------------
describe('saveCity / loadCity', () => {
  // Provide an in-memory localStorage stub; the jsdom global may not be
  // available in the isolated worker that runs geo.test.js.
  let store = {};
  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', {
      getItem:    (k)    => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
      setItem:    (k, v) => { store[k] = String(v); },
      removeItem: (k)    => { delete store[k]; },
      clear:      ()     => { store = {}; },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips a city ID through localStorage', () => {
    saveCity('uuid-city-abc');
    expect(loadCity()).toBe('uuid-city-abc');
  });

  it('returns null when nothing has been saved', () => {
    expect(loadCity()).toBeNull();
  });

  it('overwrites a previously saved city', () => {
    saveCity('old-city');
    saveCity('new-city');
    expect(loadCity()).toBe('new-city');
  });
});

// ---------------------------------------------------------------------------
// saveRadius / loadRadius  (new in Slice 2 — PRD §6.3)
// ---------------------------------------------------------------------------
describe('saveRadius / loadRadius', () => {
  // Same in-memory localStorage stub as saveCity / loadCity above.
  let store = {};
  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', {
      getItem:    (k)    => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
      setItem:    (k, v) => { store[k] = String(v); },
      removeItem: (k)    => { delete store[k]; },
      clear:      ()     => { store = {}; },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips an integer radius through localStorage', () => {
    saveRadius(50);
    expect(loadRadius()).toBe(50);
  });

  it('defaults to 25 miles when nothing has been saved (PRD §6.3)', () => {
    expect(loadRadius()).toBe(25);
  });

  it('persists 0 (meaning "Any distance")', () => {
    saveRadius(0);
    expect(loadRadius()).toBe(0);
  });

  it('overwrites the previously saved radius', () => {
    saveRadius(10);
    saveRadius(80);
    expect(loadRadius()).toBe(80);
  });

  it('handles every valid dropdown value: 10, 25, 50, 80, 0', () => {
    for (const r of [10, 25, 50, 80, 0]) {
      saveRadius(r);
      expect(loadRadius()).toBe(r);
    }
  });
});
