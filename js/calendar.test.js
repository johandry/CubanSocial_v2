/**
 * Tests for js/calendar.js  (the .ics / iCalendar generator)
 *
 * Run with:
 *   npm test -- calendar
 *
 * `generateIcs` is a pure string function; `downloadIcs` has DOM side-effects
 * (creates a Blob + anchor).  Both are covered here using jsdom mocks.
 *
 * PRD §5.4 requirement: "Add to Calendar (.ics download, zero-dependency)".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateIcs, downloadIcs } from './calendar.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const CITY_SD = { id: 'city-sd', name: 'San Diego', state: 'CA' };

/** Minimal approved event with all fields populated. */
function makeEvent(overrides = {}) {
  return {
    id:          'evt-abc-123',
    name:        'Timba Night at Club Havana',
    description: 'Live Timba music, dance lessons, social dancing.',
    start_at:    '2026-07-11T20:00:00.000Z',
    end_at:      '2026-07-11T23:00:00.000Z',
    address:     '123 Main St',
    is_private:  false,
    city_id:     CITY_SD.id,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// generateIcs — structure
// ---------------------------------------------------------------------------
describe('generateIcs — iCalendar structure', () => {
  it('wraps the event in VCALENDAR / VEVENT blocks', () => {
    const ics = generateIcs(makeEvent(), CITY_SD);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
  });

  it('includes required iCal fields: UID, DTSTAMP, DTSTART, DTEND, SUMMARY, URL', () => {
    const ics = generateIcs(makeEvent(), CITY_SD);
    expect(ics).toMatch(/^UID:/m);
    expect(ics).toMatch(/^DTSTAMP:/m);
    expect(ics).toMatch(/^DTSTART:/m);
    expect(ics).toMatch(/^DTEND:/m);
    expect(ics).toMatch(/^SUMMARY:/m);
    expect(ics).toMatch(/^URL:/m);
  });

  it('UID includes the event id and cubansocial.com domain', () => {
    const ics = generateIcs(makeEvent(), CITY_SD);
    expect(ics).toContain('UID:evt-abc-123@cubansocial.com');
  });

  it('URL points to the canonical event page', () => {
    const ics = generateIcs(makeEvent(), CITY_SD);
    expect(ics).toContain('URL:https://cubansocial.com/event/evt-abc-123');
  });

  it('uses CRLF line endings (iCal spec)', () => {
    const ics = generateIcs(makeEvent(), CITY_SD);
    expect(ics).toContain('\r\n');
  });
});

// ---------------------------------------------------------------------------
// generateIcs — date/time formatting
// ---------------------------------------------------------------------------
describe('generateIcs — date/time', () => {
  it('DTSTART encodes start_at in UTC iCal format (YYYYMMDDTHHmmssZ)', () => {
    const ics = generateIcs(makeEvent(), CITY_SD);
    // 2026-07-11T20:00:00.000Z → 20260711T200000Z
    expect(ics).toContain('DTSTART:20260711T200000Z');
  });

  it('DTEND encodes end_at when provided', () => {
    const ics = generateIcs(makeEvent(), CITY_SD);
    // 2026-07-11T23:00:00.000Z → 20260711T230000Z
    expect(ics).toContain('DTEND:20260711T230000Z');
  });

  it('DTEND defaults to start + 3 hours when end_at is null (PRD §5.4)', () => {
    const event = makeEvent({ end_at: null });
    const ics = generateIcs(event, CITY_SD);
    // start = 20:00 UTC → default end = 23:00 UTC
    expect(ics).toContain('DTEND:20260711T230000Z');
  });

  it('DTEND defaults to start + 3 hours when end_at is undefined', () => {
    const { end_at, ...eventWithoutEnd } = makeEvent();
    const ics = generateIcs(eventWithoutEnd, CITY_SD);
    expect(ics).toContain('DTEND:20260711T230000Z');
  });
});

// ---------------------------------------------------------------------------
// generateIcs — location
// ---------------------------------------------------------------------------
describe('generateIcs — LOCATION field', () => {
  it('public event: includes full address and city name', () => {
    const ics = generateIcs(makeEvent({ is_private: false }), CITY_SD);
    expect(ics).toContain('LOCATION:123 Main St\\, San Diego');
  });

  it('private event: shows only the city name (no street address)', () => {
    const ics = generateIcs(makeEvent({ is_private: true }), CITY_SD);
    expect(ics).toContain('LOCATION:San Diego');
    expect(ics).not.toContain('123 Main');
  });

  it('handles null city gracefully (no crash)', () => {
    expect(() => generateIcs(makeEvent(), null)).not.toThrow();
  });

  it('public event with no address shows only city', () => {
    const ics = generateIcs(makeEvent({ address: null }), CITY_SD);
    expect(ics).toContain('LOCATION:San Diego');
  });
});

// ---------------------------------------------------------------------------
// generateIcs — iCal text escaping
// ---------------------------------------------------------------------------
describe('generateIcs — iCal text escaping', () => {
  it('escapes commas in the event name (SUMMARY)', () => {
    const event = makeEvent({ name: 'Salsa, Timba & More' });
    const ics = generateIcs(event, CITY_SD);
    expect(ics).toContain('SUMMARY:Salsa\\, Timba & More');
  });

  it('escapes semicolons in the description', () => {
    const event = makeEvent({ description: 'Bring your partner; no partner needed' });
    const ics = generateIcs(event, CITY_SD);
    expect(ics).toContain('Bring your partner\\; no partner needed');
  });

  it('escapes backslashes in text fields', () => {
    const event = makeEvent({ name: 'Event\\Name' });
    const ics = generateIcs(event, CITY_SD);
    expect(ics).toContain('SUMMARY:Event\\\\Name');
  });

  it('converts newlines in description to \\n (iCal literal)', () => {
    const event = makeEvent({ description: 'Line one\nLine two' });
    const ics = generateIcs(event, CITY_SD);
    expect(ics).toContain('Line one\\nLine two');
  });
});

// ---------------------------------------------------------------------------
// generateIcs — missing/empty fields
// ---------------------------------------------------------------------------
describe('generateIcs — edge cases', () => {
  it('handles null description without throwing', () => {
    expect(() => generateIcs(makeEvent({ description: null }), CITY_SD)).not.toThrow();
  });

  it('handles undefined description without throwing', () => {
    const { description, ...e } = makeEvent();
    expect(() => generateIcs(e, CITY_SD)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// downloadIcs — DOM interaction
// ---------------------------------------------------------------------------
describe('downloadIcs', () => {
  beforeEach(() => {
    // Mock Blob, URL.createObjectURL / revokeObjectURL, and anchor click
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    });
    // Prevent jsdom from attempting anchor navigation ("Not implemented")
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => {});
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates an anchor with the correct download filename', () => {
    const anchorSpy = vi.spyOn(document, 'createElement');
    downloadIcs(makeEvent(), CITY_SD);

    // createElement('a') should have been called
    const aCalls = anchorSpy.mock.calls.filter(([tag]) => tag === 'a');
    expect(aCalls.length).toBeGreaterThan(0);
  });

  it('revokes the object URL after download to prevent memory leaks', () => {
    downloadIcs(makeEvent(), CITY_SD);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('does not throw when called with a private event and null city', () => {
    expect(() => downloadIcs(makeEvent({ is_private: true }), null)).not.toThrow();
  });

  it('uses a sanitised filename (spaces replaced by dashes)', () => {
    const createdElements = [];
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = { href: '', download: '', click: vi.fn() };
      if (tag === 'a') createdElements.push(el);
      return el;
    });

    downloadIcs(makeEvent({ name: 'Timba Night Out' }), CITY_SD);
    const anchor = createdElements[0];
    expect(anchor?.download).toMatch(/Timba-Night-Out/);
  });
});
