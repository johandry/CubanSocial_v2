/**
 * Tests for js/main.js — Slice 2: Public Event Feed Polish
 *
 * Run with:
 *   npm test -- main
 *
 * Organisation:
 *   1. costLabel             — cost badge text & CSS class
 *   2. costTooltipHtml       — (?) tooltip button
 *   3. buildOrganizerLink    — Instagram / WhatsApp / email / other contact links
 *   4. dotColor              — calendar dot colour by event type
 *   5. buildEventsByDate     — calendar day-keyed event map
 *   6. updateOgMeta          — OG <meta> tag updates (DOM)
 *   7. renderCard            — event card DOM rendering (all card variants)
 *
 * External dependencies are mocked so no network or Supabase calls are made:
 *   - js/config.js  → fake Supabase `db` client
 *   - js/geo.js     → stubbed geolocation helpers (no browser API needed)
 *   - js/parser.js  → stub (not exercised in these tests)
 *   - js/calendar.js → stub (downloadIcs not needed for these tests)
 *
 * PRD references:
 *   §5.3  Event Card components (all card types, featured badge, cost tooltip)
 *   §5.4  Event Detail Modal (organizer contact links, OG meta)
 *   §5.7  Calendar view (dot colour, day-keyed map)
 *   §6.3  Geolocation / radius logic
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock external modules BEFORE importing main.js
// ---------------------------------------------------------------------------

// Mock Supabase client — returns empty data by default; individual tests
// can override with mockResolvedValueOnce when testing async flows.
vi.mock('./config.js', () => {
  const chainable = {
    select:   vi.fn().mockReturnThis(),
    eq:       vi.fn().mockReturnThis(),
    gte:      vi.fn().mockReturnThis(),
    lte:      vi.fn().mockReturnThis(),
    order:    vi.fn().mockReturnThis(),
    limit:    vi.fn().mockResolvedValue({ data: [], error: null }),
    contains: vi.fn().mockReturnThis(),
    in:       vi.fn().mockReturnThis(),
    insert:   vi.fn().mockResolvedValue({ error: null }),
    single:   vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  return { db: { from: vi.fn(() => chainable) } };
});

// Mock geo.js — pure functions are tested in geo.test.js; here we just need
// them to not throw and return predictable values.
vi.mock('./geo.js', () => ({
  requestGeolocation:   vi.fn().mockResolvedValue(null),
  nearestCity:          vi.fn().mockReturnValue(null),
  citiesWithinRadius:   vi.fn().mockReturnValue([]),
  saveCity:             vi.fn(),
  loadCity:             vi.fn().mockReturnValue(null),
  saveRadius:           vi.fn(),
  loadRadius:           vi.fn().mockReturnValue(25),
}));

// Minimal stubs for parser and calendar — not under test here.
vi.mock('./parser.js', () => ({
  parseEventText: vi.fn().mockReturnValue({ _filledCount: 0 }),
}));
vi.mock('./calendar.js', () => ({
  downloadIcs: vi.fn(),
  generateIcs: vi.fn().mockReturnValue('BEGIN:VCALENDAR\r\nEND:VCALENDAR'),
}));

// ---------------------------------------------------------------------------
// Set up the minimal DOM that main.js init() would normally find.
// Without this, getElementById calls throw when the module is first imported.
// ---------------------------------------------------------------------------
function buildMinimalDom() {
  document.body.innerHTML = `
    <select id="city-select"></select>
    <select id="filter-style"></select>
    <select id="filter-radius"><option value="25" selected>25 mi</option></select>
    <select id="filter-type"></select>
    <input type="date"  id="filter-date-from" />
    <input type="date"  id="filter-date-to" />
    <input type="checkbox" id="filter-featured" />
    <div id="radius-selector" style="display:none"></div>
    <div id="grid-section"></div>
    <div id="calendar-section" hidden></div>
    <div id="events-cards"></div>
    <div id="load-more-container" hidden><button id="load-more-btn"></button></div>
    <button id="view-grid-btn" class="is-active" aria-pressed="true"></button>
    <button id="view-calendar-btn" aria-pressed="false"></button>
    <h2 id="cal-title"></h2>
    <div id="cal-header"></div>
    <button id="cal-prev-btn"></button>
    <button id="cal-next-btn"></button>
    <button id="cal-today-btn"></button>
    <div id="cal-loading" hidden></div>
    <div id="cal-grid-container"></div>
    <div id="cal-day-panel" hidden></div>
    <div id="event-modal" hidden>
      <button class="modal__close" id="modal-close-btn"></button>
      <div id="modal-content"></div>
    </div>
    <div id="submit-modal" hidden>
      <button class="modal__close" id="submit-modal-close"></button>
      <button id="submit-event-cta"></button>
      <button id="cancel-submit-btn"></button>
      <button id="tab-paste" class="is-active" aria-selected="true"></button>
      <button id="tab-manual" aria-selected="false"></button>
      <div id="panel-paste"></div>
      <div id="panel-manual" hidden></div>
      <button id="parse-btn"></button>
      <button id="ai-assist-btn" hidden></button>
      <p id="parse-status"></p>
      <div id="clarification-questions"></div>
      <textarea id="paste-textarea"></textarea>
      <div id="event-form-fields"></div>
      <form id="event-form"><button type="submit">Submit</button></form>
      <input type="text" name="website" id="hp-field" />
    </div>
    <div id="toast-container"></div>
    <button id="allow-location-btn"></button>
    <p id="location-status"></p>
  `;
}

// Seed the DOM before importing so init()'s getElementById calls don't crash.
buildMinimalDom();

// Now import the named exports — init() will NOT run because
// import.meta.env.MODE === 'test' in the Vitest environment.
import {
  costLabel,
  costTooltipHtml,
  buildOrganizerLink,
  dotColor,
  buildEventsByDate,
  updateOgMeta,
  renderCard,
  state,
} from './main.js';

// ---------------------------------------------------------------------------
// Reset shared state before every test so tests don't bleed into each other.
// ---------------------------------------------------------------------------
beforeEach(() => {
  buildMinimalDom();

  // Seed state with reference data used by renderCard
  state.cities = [
    { id: 'city-sd', name: 'San Diego',   state: 'CA', lat: 32.7157, lon: -117.1611 },
    { id: 'city-la', name: 'Los Angeles', state: 'CA', lat: 34.0522, lon: -118.2437 },
  ];
  state.danceStyles = [
    { id: 'style-timba',   name: 'Timba',   slug: 'timba' },
    { id: 'style-bachata', name: 'Bachata', slug: 'bachata' },
  ];
  state.events    = [];
  state.calEvents = [];
  state.viewMode  = 'grid';
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeEvent(overrides = {}) {
  return {
    id:               'evt-001',
    name:             'Timba Night',
    description:      'Best Timba in San Diego.',
    start_at:         '2026-07-11T20:00:00.000Z',
    end_at:           null,
    city_id:          'city-sd',
    address:          '123 Main St',
    is_private:       false,
    is_featured:      false,
    event_type:       'studio_local',
    dance_style_ids:  ['style-timba'],
    cost_type:        'free',
    cost_amount:      null,
    cost_notes:       null,
    organizer_name:   'Ana Reyes',
    organizer_contact: '@anareyes',
    organizer_contact_type: 'instagram',
    media_url:        null,
    external_link:    null,
    status:           'approved',
    ...overrides,
  };
}

// ============================================================================
// 1. costLabel
// ============================================================================
describe('costLabel', () => {
  it('"free" → text "Free" with tag--free class', () => {
    const { text, cls } = costLabel({ cost_type: 'free' });
    expect(text).toBe('Free');
    expect(cls).toBe('tag--free');
  });

  it('"paid" with amount → "$15" with tag--paid class', () => {
    const { text, cls } = costLabel({ cost_type: 'paid', cost_amount: 15 });
    expect(text).toBe('$15');
    expect(cls).toBe('tag--paid');
  });

  it('"paid" without amount → fallback text with tag--style class', () => {
    const { text, cls } = costLabel({ cost_type: 'paid', cost_amount: null });
    expect(cls).toBe('tag--style');
    // Text should still be non-empty (the cost_type string)
    expect(text.length).toBeGreaterThan(0);
  });

  it('"potluck" → text "Potluck" with tag--style class', () => {
    const { text, cls } = costLabel({ cost_type: 'potluck' });
    expect(text).toBe('Potluck');
    expect(cls).toBe('tag--style');
  });

  it('"tips" → text "Tips welcome" with tag--style class', () => {
    const { text, cls } = costLabel({ cost_type: 'tips' });
    expect(text).toBe('Tips welcome');
    expect(cls).toBe('tag--style');
  });

  it('"sliding_scale" → text "Sliding scale" with tag--style class', () => {
    const { text, cls } = costLabel({ cost_type: 'sliding_scale' });
    expect(text).toBe('Sliding scale');
    expect(cls).toBe('tag--style');
  });

  it('decimal cost_amount is rendered correctly', () => {
    const { text } = costLabel({ cost_type: 'paid', cost_amount: 12.5 });
    expect(text).toBe('$12.5');
  });
});

// ============================================================================
// 2. costTooltipHtml — PRD §5.3: "(?) icon inline next to cost badge"
// ============================================================================
describe('costTooltipHtml', () => {
  it('returns an empty string when cost_notes is null', () => {
    expect(costTooltipHtml(null)).toBe('');
  });

  it('returns an empty string when cost_notes is undefined', () => {
    expect(costTooltipHtml(undefined)).toBe('');
  });

  it('returns an empty string for an empty string', () => {
    expect(costTooltipHtml('')).toBe('');
  });

  it('returns a button element with the note in data-tooltip', () => {
    const html = costTooltipHtml('Ladies free before 10 PM');
    expect(html).toContain('data-tooltip="Ladies free before 10 PM"');
    expect(html).toContain('<button');
  });

  it('displays "(?) " as the visible trigger text', () => {
    const html = costTooltipHtml('Any note');
    expect(html).toContain('(?)');
  });

  it('escapes double-quote characters to prevent attribute injection', () => {
    const html = costTooltipHtml('Say "hello"');
    expect(html).toContain('&quot;');
    expect(html).not.toContain('"hello"');
  });

  it('escapes < to prevent HTML injection in the tooltip text', () => {
    const html = costTooltipHtml('<script>alert(1)</script>');
    expect(html).toContain('&lt;');
    expect(html).not.toContain('<script>');
  });
});

// ============================================================================
// 3. buildOrganizerLink — PRD §5.4: "organizer contact linked button"
// ============================================================================
describe('buildOrganizerLink', () => {
  it('returns empty string when organizer_contact is null', () => {
    expect(buildOrganizerLink({ organizer_contact: null })).toBe('');
  });

  it('returns empty string when organizer_contact is undefined', () => {
    expect(buildOrganizerLink({})).toBe('');
  });

  // Instagram
  describe('instagram type', () => {
    it('builds an instagram.com link from a @handle (PRD §5.4)', () => {
      const html = buildOrganizerLink({
        organizer_contact: '@anareyes',
        organizer_contact_type: 'instagram',
        organizer_name: 'Ana',
      });
      expect(html).toContain('href="https://instagram.com/anareyes"');
    });

    it('strips the leading @ before building the URL', () => {
      const html = buildOrganizerLink({
        organizer_contact: '@salsaking',
        organizer_contact_type: 'instagram',
      });
      expect(html).not.toContain('instagram.com/@');
      expect(html).toContain('instagram.com/salsaking');
    });

    it('works correctly if handle is provided without @', () => {
      const html = buildOrganizerLink({
        organizer_contact: 'salsaking',
        organizer_contact_type: 'instagram',
      });
      expect(html).toContain('instagram.com/salsaking');
    });

    it('opens in a new tab with rel="noopener noreferrer"', () => {
      const html = buildOrganizerLink({
        organizer_contact: '@test',
        organizer_contact_type: 'instagram',
      });
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
    });
  });

  // WhatsApp
  describe('whatsapp type', () => {
    it('builds a wa.me link with digits only (PRD §5.4)', () => {
      const html = buildOrganizerLink({
        organizer_contact: '+1 (619) 555-1234',
        organizer_contact_type: 'whatsapp',
        organizer_name: 'DJ Timba',
      });
      expect(html).toContain('href="https://wa.me/16195551234"');
    });

    it('strips all non-digit characters from the phone number', () => {
      const html = buildOrganizerLink({
        organizer_contact: '(858) 555.9090',
        organizer_contact_type: 'whatsapp',
      });
      // All punctuation stripped → 8585559090
      expect(html).toContain('wa.me/8585559090');
    });
  });

  // Email
  describe('email type', () => {
    it('builds a mailto link', () => {
      const html = buildOrganizerLink({
        organizer_contact: 'dance@example.com',
        organizer_contact_type: 'email',
        organizer_name: 'Dance Studio',
      });
      expect(html).toContain('href="mailto:dance@example.com"');
    });
  });

  // Other / unknown type
  describe('other / unknown type', () => {
    it('falls back to showing raw contact info in a paragraph', () => {
      const html = buildOrganizerLink({
        organizer_contact: 'Ask at the door',
        organizer_contact_type: 'other',
        organizer_name: 'Studio',
      });
      expect(html).toContain('Ask at the door');
      // Should NOT produce an <a> href link for unknown types
      expect(html).not.toContain('href=');
    });
  });
});

// ============================================================================
// 4. dotColor — PRD §5.7: "coloured dot indicators"
// ============================================================================
describe('dotColor', () => {
  it('featured events → yellow (var(--yellow))', () => {
    expect(dotColor({ is_featured: true,  event_type: 'studio_local' })).toBe('var(--yellow)');
  });

  it('congress_national → red (var(--red))', () => {
    expect(dotColor({ is_featured: false, event_type: 'congress_national' })).toBe('var(--red)');
  });

  it('congress_international → red (var(--red))', () => {
    expect(dotColor({ is_featured: false, event_type: 'congress_international' })).toBe('var(--red)');
  });

  it('private social → muted (var(--muted))', () => {
    expect(dotColor({ is_featured: false, is_private: true, event_type: 'social_local' })).toBe('var(--muted)');
  });

  it('regular studio event → blue (var(--blue))', () => {
    expect(dotColor({ is_featured: false, is_private: false, event_type: 'studio_local' })).toBe('var(--blue)');
  });

  it('featured flag takes priority over congress type', () => {
    // is_featured wins — yellow even if it's also a congress event
    expect(dotColor({ is_featured: true, event_type: 'congress_national' })).toBe('var(--yellow)');
  });
});

// ============================================================================
// 5. buildEventsByDate — PRD §5.7: "coloured dot indicators per day"
// ============================================================================
describe('buildEventsByDate', () => {
  it('returns an empty Map for an empty events array', () => {
    const map = buildEventsByDate([]);
    expect(map.size).toBe(0);
  });

  it('groups a single event under its YYYY-MM-DD key', () => {
    const events = [makeEvent({ start_at: '2026-07-11T20:00:00.000Z' })];
    const map = buildEventsByDate(events);
    expect(map.has('2026-07-11')).toBe(true);
    expect(map.get('2026-07-11')).toHaveLength(1);
  });

  it('groups multiple events on the same day under one key', () => {
    const events = [
      makeEvent({ id: 'e1', start_at: '2026-07-11T18:00:00.000Z' }),
      makeEvent({ id: 'e2', start_at: '2026-07-11T21:00:00.000Z' }),
    ];
    const map = buildEventsByDate(events);
    expect(map.get('2026-07-11')).toHaveLength(2);
  });

  it('separates events on different days into different keys', () => {
    const events = [
      makeEvent({ id: 'e1', start_at: '2026-07-11T20:00:00.000Z' }),
      makeEvent({ id: 'e2', start_at: '2026-07-12T20:00:00.000Z' }),
    ];
    const map = buildEventsByDate(events);
    expect(map.size).toBe(2);
    expect(map.get('2026-07-11')).toHaveLength(1);
    expect(map.get('2026-07-12')).toHaveLength(1);
  });

  it('uses state.calEvents as the default when no argument is passed', () => {
    state.calEvents = [makeEvent({ start_at: '2026-08-01T19:00:00.000Z' })];
    const map = buildEventsByDate(); // no arg → uses state
    expect(map.has('2026-08-01')).toBe(true);
  });
});

// ============================================================================
// 6. updateOgMeta — PRD §10: "OG meta tags updated per-event when modal opens"
// ============================================================================
describe('updateOgMeta', () => {
  beforeEach(() => {
    // Ensure the relevant <meta> tags exist in jsdom
    document.head.innerHTML = `
      <meta property="og:title"       content="" />
      <meta property="og:description" content="" />
      <meta property="og:url"         content="" />
      <meta property="og:image"       content="" />
    `;
  });

  it('sets og:title meta content', () => {
    updateOgMeta({ title: 'Timba Night — CubanSocial', description: '', url: '', image: '' });
    const el = document.querySelector('meta[property="og:title"]');
    expect(el.getAttribute('content')).toBe('Timba Night — CubanSocial');
  });

  it('sets og:description meta content', () => {
    updateOgMeta({ title: '', description: 'The best Timba in SD.', url: '', image: '' });
    const el = document.querySelector('meta[property="og:description"]');
    expect(el.getAttribute('content')).toBe('The best Timba in SD.');
  });

  it('sets og:url meta content', () => {
    updateOgMeta({ title: '', description: '', url: 'https://cubansocial.com/event/evt-001', image: '' });
    const el = document.querySelector('meta[property="og:url"]');
    expect(el.getAttribute('content')).toBe('https://cubansocial.com/event/evt-001');
  });

  it('sets og:image meta content when a media URL is provided', () => {
    updateOgMeta({ title: '', description: '', url: '', image: 'https://example.com/poster.jpg' });
    const el = document.querySelector('meta[property="og:image"]');
    expect(el.getAttribute('content')).toBe('https://example.com/poster.jpg');
  });

  it('clears og:image when image is null / empty (no stale image after closing modal)', () => {
    // First set an image
    updateOgMeta({ title: '', description: '', url: '', image: 'https://example.com/old.jpg' });
    // Then clear it
    updateOgMeta({ title: '', description: '', url: '', image: null });
    const el = document.querySelector('meta[property="og:image"]');
    expect(el.getAttribute('content')).toBe('');
  });

  it('updates document.title to match the event title', () => {
    updateOgMeta({ title: 'Timba Night — CubanSocial', description: '', url: '', image: '' });
    expect(document.title).toBe('Timba Night — CubanSocial');
  });
});

// ============================================================================
// 7. renderCard — PRD §5.3: all event card types
// ============================================================================
describe('renderCard', () => {
  // --- Shared structure ---
  it('returns an <article> element', () => {
    const card = renderCard(makeEvent());
    expect(card.tagName).toBe('ARTICLE');
  });

  it('sets data-event-id to the event id', () => {
    const card = renderCard(makeEvent({ id: 'evt-xyz' }));
    expect(card.dataset.eventId).toBe('evt-xyz');
  });

  it('renders the event name in an h3 heading', () => {
    const card = renderCard(makeEvent({ name: 'Salsa Sunday' }));
    expect(card.querySelector('h3')?.textContent).toBe('Salsa Sunday');
  });

  it('renders the dance style chips for all selected styles', () => {
    const card = renderCard(makeEvent({ dance_style_ids: ['style-timba', 'style-bachata'] }));
    const chips = card.querySelectorAll('.tag.tag--style');
    const names = [...chips].map((c) => c.textContent);
    expect(names).toContain('Timba');
    expect(names).toContain('Bachata');
  });

  it('includes a "View Details" button with data-action="view-event"', () => {
    const card = renderCard(makeEvent());
    const btn = card.querySelector('[data-action="view-event"]');
    expect(btn).not.toBeNull();
  });

  // --- Studio / Org event (studio_local) ---
  describe('studio_local card', () => {
    it('shows the street address in the location text', () => {
      const card = renderCard(makeEvent({ event_type: 'studio_local', address: '123 Main St', is_private: false }));
      expect(card.querySelector('.event-card__location')?.textContent).toContain('123 Main St');
    });

    it('does NOT show a lock icon or "Private" tag', () => {
      const card = renderCard(makeEvent({ event_type: 'studio_local', is_private: false }));
      expect(card.innerHTML).not.toContain('🔒');
    });
  });

  // --- Private social (social_local, is_private = true) ---
  describe('social_local private card', () => {
    it('shows lock icon and "Contact Organizer" in location (PRD §5.3)', () => {
      const card = renderCard(makeEvent({ event_type: 'social_local', is_private: true }));
      const loc = card.querySelector('.event-card__location')?.textContent ?? '';
      expect(loc).toContain('🔒');
      expect(loc).toContain('Contact Organizer');
    });

    it('does NOT show the street address', () => {
      const card = renderCard(makeEvent({
        event_type: 'social_local',
        is_private: true,
        address: '456 Secret Lane',
      }));
      expect(card.textContent).not.toContain('456 Secret Lane');
    });

    it('renders a "🔒 Private" badge in the tags row', () => {
      const card = renderCard(makeEvent({ event_type: 'social_local', is_private: true }));
      expect(card.innerHTML).toContain('tag--private');
    });
  });

  // --- Public social (social_local, is_private = false) ---
  describe('social_local public card', () => {
    it('shows the full address when is_private = false', () => {
      const card = renderCard(makeEvent({ event_type: 'social_local', is_private: false, address: '789 Open Ave' }));
      expect(card.querySelector('.event-card__location')?.textContent).toContain('789 Open Ave');
    });
  });

  // --- National congress ---
  describe('congress_national card', () => {
    it('renders a "National Congress" badge (PRD §5.3)', () => {
      const card = renderCard(makeEvent({ event_type: 'congress_national', is_private: false }));
      expect(card.innerHTML).toContain('National Congress');
      expect(card.innerHTML).toContain('tag--congress');
    });
  });

  // --- International congress ---
  describe('congress_international card', () => {
    it('renders an "Intl. Congress" badge', () => {
      const card = renderCard(makeEvent({ event_type: 'congress_international', is_private: false }));
      expect(card.innerHTML).toContain('Intl. Congress');
      expect(card.innerHTML).toContain('tag--congress');
    });
  });

  // --- Featured event ---
  describe('featured event card', () => {
    it('adds event-card--featured CSS class for featured events (PRD §5.3)', () => {
      const card = renderCard(makeEvent({ is_featured: true }));
      expect(card.classList.contains('event-card--featured')).toBe(true);
    });

    it('does NOT add event-card--featured when is_featured = false', () => {
      const card = renderCard(makeEvent({ is_featured: false }));
      expect(card.classList.contains('event-card--featured')).toBe(false);
    });
  });

  // --- Cost badge ---
  describe('cost badge', () => {
    it('renders a "Free" badge for free events', () => {
      const card = renderCard(makeEvent({ cost_type: 'free' }));
      expect(card.innerHTML).toContain('tag--free');
      expect(card.textContent).toContain('Free');
    });

    it('renders the cost amount for paid events', () => {
      const card = renderCard(makeEvent({ cost_type: 'paid', cost_amount: 20 }));
      expect(card.textContent).toContain('$20');
    });
  });

  // --- Cost notes tooltip (PRD §5.3) ---
  describe('cost notes (?) tooltip', () => {
    it('renders a .cost-tooltip button when cost_notes is set', () => {
      const card = renderCard(makeEvent({ cost_notes: 'Ladies free before 10 PM' }));
      const tooltip = card.querySelector('.cost-tooltip');
      expect(tooltip).not.toBeNull();
      expect(tooltip?.getAttribute('data-tooltip')).toBe('Ladies free before 10 PM');
    });

    it('does NOT render a .cost-tooltip button when cost_notes is null', () => {
      const card = renderCard(makeEvent({ cost_notes: null }));
      expect(card.querySelector('.cost-tooltip')).toBeNull();
    });
  });

  // --- Media image ---
  describe('event media', () => {
    it('renders an <img> when media_url is a direct image URL', () => {
      const card = renderCard(makeEvent({ media_url: 'https://example.com/poster.jpg' }));
      const img = card.querySelector('img');
      expect(img).not.toBeNull();
      expect(img?.getAttribute('src')).toBe('https://example.com/poster.jpg');
    });

    it('renders the 🎵 placeholder when media_url is a social-media post URL (not an image)', () => {
      const card = renderCard(makeEvent({ media_url: 'https://instagram.com/p/abc123' }));
      expect(card.querySelector('img')).toBeNull();
      expect(card.innerHTML).toContain('🎵');
    });

    it('renders the 🎵 placeholder when media_url is null', () => {
      const card = renderCard(makeEvent({ media_url: null }));
      expect(card.querySelector('img')).toBeNull();
      expect(card.innerHTML).toContain('🎵');
    });

    it('accepts .png, .gif, and .webp image URLs', () => {
      for (const ext of ['png', 'gif', 'webp']) {
        const card = renderCard(makeEvent({ media_url: `https://cdn.example.com/img.${ext}` }));
        expect(card.querySelector('img')).not.toBeNull();
      }
    });
  });

  // --- city resolved from state ---
  it('shows the city name in the location text', () => {
    const card = renderCard(makeEvent({ city_id: 'city-la', is_private: false, address: '' }));
    const loc = card.querySelector('.event-card__location')?.textContent ?? '';
    expect(loc).toContain('Los Angeles');
  });

  it('handles an unknown city_id gracefully (no crash, empty city name)', () => {
    expect(() => renderCard(makeEvent({ city_id: 'unknown-city' }))).not.toThrow();
  });
});
