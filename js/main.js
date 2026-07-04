/**
 * CubanSocial — App entry point (Slice 2: Public Event Feed Polish)
 *
 * Features added in this slice:
 * - Grid / Calendar view toggle
 * - Calendar: month grid with event dots, day-click panel, mobile 3-day strip
 * - Radius dropdown (10 / 25 / 50 / 80 / Any) persisted in localStorage
 * - Featured badge on cards; all events in one grid (no separate featured row)
 * - Cost notes (?) tooltip on cards and event detail modal
 * - Event card variants: studio_local, social_local private, congress badges
 * - Event detail modal: organizer contact links (Instagram / WhatsApp / email)
 * - OG meta tag updates per-event
 * - Deep-link /event/{id} with GitHub Pages 404→?path= redirect support
 * - Load more (30-day window extension)
 * - Empty state and loading spinner
 */

import { db } from './config.js';
import {
  requestGeolocation, nearestCity, citiesWithinRadius,
  saveCity, loadCity, saveRadius, loadRadius,
} from './geo.js';
import { parseEventText }  from './parser.js';
import { downloadIcs }     from './calendar.js';

// ---------------------------------------------------------------
// App state
// ---------------------------------------------------------------
let state = {
  cities:          [],
  danceStyles:     [],
  events:          [],          // events currently shown in grid view
  selectedCityId:  null,
  userCoords:      null,        // { lat, lon } — set after geolocation grant
  filterStyle:     '',
  filterType:      '',
  filterDateFrom:  '',
  filterDateTo:    '',
  filterFeatured:  false,
  selectedRadius:  25,          // miles; 0 = Any distance
  feedWindowEnd:   null,        // upper bound of the grid view window
  hasMore:         true,        // whether more events might exist beyond window
  // Calendar state
  viewMode:        'grid',      // 'grid' | 'calendar'
  calYear:         new Date().getFullYear(),
  calMonth:        new Date().getMonth(), // 0-indexed
  calSelectedDay:  null,        // 'YYYY-MM-DD' string, or null
  calEvents:       [],          // all events for the displayed calendar month
  calStripCenter:  new Date(),  // center day of mobile 3-day strip
};

// ---------------------------------------------------------------
// Toast notifications
// ---------------------------------------------------------------
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

// ---------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------
function fmtEventDate(isoStr) {
  const d = new Date(isoStr);
  return (
    d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  );
}

function fmtDateLong(isoStr) {
  return new Date(isoStr).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function fmtTime(isoStr) {
  return new Date(isoStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Returns { text, cls } for the cost badge. */
function costLabel(event) {
  if (event.cost_type === 'free')           return { text: 'Free',          cls: 'tag--free' };
  if (event.cost_type === 'potluck')        return { text: 'Potluck',        cls: 'tag--style' };
  if (event.cost_type === 'tips')           return { text: 'Tips welcome',   cls: 'tag--style' };
  if (event.cost_type === 'sliding_scale')  return { text: 'Sliding scale',  cls: 'tag--style' };
  if (event.cost_type === 'paid' && event.cost_amount)
    return { text: `$${event.cost_amount}`, cls: 'tag--paid' };
  return { text: event.cost_type ?? '', cls: 'tag--style' };
}

/**
 * Builds a (?) tooltip button for cost_notes.
 * Uses [data-tooltip] CSS tooltips — no JS needed for display.
 */
function costTooltipHtml(costNotes) {
  if (!costNotes) return '';
  const escaped = costNotes.replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<button class="cost-tooltip" data-tooltip="${escaped}" aria-label="Cost details: ${escaped}" type="button">(?)</button>`;
}

// ---------------------------------------------------------------
// OG meta tag updates (per-event when modal opens)
// ---------------------------------------------------------------
function updateOgMeta({ title, description, url, image }) {
  const setMeta = (prop, content) => {
    const el = document.querySelector(`meta[property="${prop}"]`);
    if (el) el.setAttribute('content', content ?? '');
  };
  setMeta('og:title',       title);
  setMeta('og:description', description);
  setMeta('og:url',         url);
  setMeta('og:image',       image ?? '');
  document.title = title;
}

function resetOgMeta() {
  updateOgMeta({
    title:       'CubanSocial — Find Latin Dance Events Near You',
    description: 'Discover Cuban Salsa, Bachata, and Latin dance events near you.',
    url:         'https://cubansocial.com/',
    image:       '',
  });
  document.title = 'CubanSocial — Find Latin Dance Events Near You';
}

// ---------------------------------------------------------------
// Organizer contact link builder
// ---------------------------------------------------------------
function buildOrganizerLink(event) {
  const contact = event.organizer_contact;
  const type    = event.organizer_contact_type;
  const name    = event.organizer_name || 'Organizer';
  if (!contact) return '';

  let href, label;
  switch (type) {
    case 'instagram': {
      const handle = contact.replace(/^@/, '');
      href  = `https://instagram.com/${encodeURIComponent(handle)}`;
      label = `📷 @${handle} on Instagram`;
      break;
    }
    case 'whatsapp': {
      // Strip non-digits for wa.me
      const num = contact.replace(/\D/g, '');
      href  = `https://wa.me/${num}`;
      label = `💬 Message ${name} on WhatsApp`;
      break;
    }
    case 'email':
      href  = `mailto:${contact}`;
      label = `✉️ Email ${name}`;
      break;
    default:
      // Other / unknown — just show the raw contact info
      return `<p class="organizer-contact"><strong>${name}:</strong> ${contact}</p>`;
  }

  return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="btn btn--secondary btn--sm organizer-link">${label}</a>`;
}

// ---------------------------------------------------------------
// Event card renderer
// ---------------------------------------------------------------
function renderCard(event) {
  const city   = state.cities.find((c) => c.id === event.city_id);
  const styles = (event.dance_style_ids ?? [])
    .map((id) => state.danceStyles.find((s) => s.id === id))
    .filter(Boolean);
  const cost = costLabel(event);

  // Direct-image URL check: only render <img> for absolute image URLs
  const mediaSrc = event.media_url &&
    /^https?:\/\/.+\.(jpe?g|png|gif|webp)(\?.*)?$/i.test(event.media_url)
    ? event.media_url : null;

  const mediaHtml = mediaSrc
    ? `<img src="${mediaSrc}" alt="${event.name} event poster" loading="lazy" />`
    : `<span class="event-card__media-placeholder" aria-hidden="true">🎵</span>`;

  const styleChips = styles.map((s) =>
    `<span class="tag tag--style">${s.name}</span>`
  ).join('');

  // Location text varies by privacy and event type
  let locationText;
  if (event.is_private) {
    locationText = `🔒 ${city?.name ?? ''} — Contact Organizer`;
  } else {
    const parts = [event.address, city?.name].filter(Boolean);
    locationText = parts.join(', ');
  }

  // Extra type badges (congress gets its own visual treatment)
  let typeBadge = '';
  if (event.event_type === 'congress_national') {
    typeBadge = '<span class="tag tag--congress">🏛 National Congress</span>';
  } else if (event.event_type === 'congress_international') {
    typeBadge = '<span class="tag tag--congress">🌎 Intl. Congress</span>';
  }

  const featuredClass = event.is_featured ? 'event-card--featured' : '';

  const article = document.createElement('article');
  article.className = `event-card ${featuredClass}`;
  article.setAttribute('role', 'listitem');
  article.dataset.eventId = event.id;

  article.innerHTML = `
    <div class="event-card__media" aria-hidden="true">${mediaHtml}</div>
    <div class="event-card__body">
      <h3 class="event-card__name">${event.name}</h3>
      <p class="event-card__date">${fmtEventDate(event.start_at)}</p>
      <p class="event-card__location">${locationText}</p>
      <div class="event-card__tags">
        ${styleChips}
        ${typeBadge}
        <span class="tag ${cost.cls}">${cost.text}${costTooltipHtml(event.cost_notes)}</span>
        ${event.is_private ? '<span class="tag tag--private">🔒 Private</span>' : ''}
      </div>
    </div>
    <div class="event-card__footer">
      <button class="btn btn--secondary btn--sm" data-action="view-event"
              aria-label="View details for ${event.name}">
        View Details
      </button>
    </div>
  `;
  return article;
}

// ---------------------------------------------------------------
// Feed rendering (grid view — all events in one grid)
// ---------------------------------------------------------------
function renderFeed(events) {
  const grid = document.getElementById('events-cards');
  grid.innerHTML = '';

  if (events.length === 0) {
    grid.innerHTML = `
      <div class="state-message">
        <p>No upcoming events found.</p>
        <p style="font-size:.9rem; margin-top:.5rem; color:var(--muted);">
          Try adjusting your filters or expanding the distance radius.
        </p>
      </div>`;
    document.getElementById('load-more-container').hidden = true;
    return;
  }

  events.forEach((e) => grid.appendChild(renderCard(e)));

  // Show "Load more" only in grid view
  if (state.viewMode === 'grid') {
    document.getElementById('load-more-container').hidden = !state.hasMore;
  }
}

// ---------------------------------------------------------------
// Shared query builder — applies all current filters to a date range
// ---------------------------------------------------------------
function buildFilteredQuery(from, to) {
  let q = db
    .from('events')
    .select('*')
    .eq('status', 'approved')
    .gte('start_at', from.toISOString())
    .lte('start_at', to.toISOString())
    .order('start_at', { ascending: true });

  // --- Radius / city filter ---
  if (state.userCoords && state.selectedRadius > 0) {
    // Radius mode: show events in all cities within the chosen radius
    const nearby = citiesWithinRadius(state.userCoords, state.cities, state.selectedRadius);
    const ids = nearby.map((c) => c.id);
    if (ids.length) q = q.in('city_id', ids);
  } else if (state.userCoords && state.selectedRadius === 0) {
    // "Any distance" — no city filter when geolocation is active
  } else if (state.selectedCityId) {
    // No geolocation: filter by manually-selected city
    q = q.eq('city_id', state.selectedCityId);
  }

  // --- Other filters ---
  if (state.filterStyle)    q = q.contains('dance_style_ids', [state.filterStyle]);
  if (state.filterType)     q = q.eq('event_type', state.filterType);
  if (state.filterFeatured) q = q.eq('is_featured', true);

  // Date-range filter overrides the window bounds when set
  if (state.filterDateFrom) q = q.gte('start_at', state.filterDateFrom);
  if (state.filterDateTo)   q = q.lte('start_at', state.filterDateTo + 'T23:59:59');

  return q;
}

// ---------------------------------------------------------------
// Data loading — grid view
// ---------------------------------------------------------------
async function loadReferenceData() {
  const [stylesRes, citiesRes] = await Promise.all([
    db.from('dance_styles').select('*').order('name'),
    db.from('cities').select('*').eq('is_active', true).order('name'),
  ]);
  if (stylesRes.data) state.danceStyles = stylesRes.data;
  if (citiesRes.data) state.cities      = citiesRes.data;
}

async function loadEvents(append = false) {
  const grid = document.getElementById('events-cards');

  if (!append) {
    grid.innerHTML = `
      <div class="state-message">
        <div class="spinner" aria-hidden="true"></div>
        <p>Loading events…</p>
      </div>`;
    document.getElementById('load-more-container').hidden = true;
  }

  // Build 30-day window from today (or extend existing window on "Load more")
  const from = new Date();
  const to   = state.feedWindowEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  if (!append) state.feedWindowEnd = to; // record the window end on first load

  const { data, error } = await buildFilteredQuery(from, to).limit(200);

  if (error) {
    grid.innerHTML = '<p class="state-message">Failed to load events. Please try again.</p>';
    console.error('[CubanSocial] loadEvents error:', error);
    return;
  }

  const events = data ?? [];
  state.events = events;

  // Show "Load more" unless the query returned nothing new
  state.hasMore = events.length > 0;

  renderFeed(state.events);
}

// ---------------------------------------------------------------
// City selector
// ---------------------------------------------------------------
function populateCitySelector() {
  const sel = document.getElementById('city-select');
  sel.innerHTML = '<option value="">Select city…</option>';
  state.cities.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.name}, ${c.state}`;
    sel.appendChild(opt);
  });
  const saved = loadCity();
  if (saved) { sel.value = saved; state.selectedCityId = saved; }
}

function populateStyleFilter() {
  const sel = document.getElementById('filter-style');
  state.danceStyles.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    sel.appendChild(opt);
  });
}

// ---------------------------------------------------------------
// Radius selector — restore saved value
// ---------------------------------------------------------------
function initRadiusSelector() {
  const saved = loadRadius();
  state.selectedRadius = saved;
  const sel = document.getElementById('filter-radius');
  if (sel) sel.value = String(saved);

  // Hide the radius selector until geolocation is granted
  // (when geolocation is unavailable, we use the city dropdown instead)
  document.getElementById('radius-selector').style.display = 'none';
}

// ---------------------------------------------------------------
// Geolocation flow
// ---------------------------------------------------------------
async function handleLocationRequest() {
  const statusEl  = document.getElementById('location-status');
  const btn       = document.getElementById('allow-location-btn');
  const citySelect = document.getElementById('city-select');

  statusEl.textContent = 'Detecting your location…';
  btn.disabled = true;

  const coords = await requestGeolocation();
  if (coords) {
    state.userCoords = coords;

    // Auto-select the nearest city within 30 mi
    const city = nearestCity(coords, state.cities, 30);
    if (city) {
      state.selectedCityId = city.id;
      citySelect.value = city.id;
      saveCity(city.id);
      statusEl.textContent = `📍 Showing events near ${city.name}`;
    } else {
      statusEl.textContent = 'No city found within 30 mi — select manually below.';
    }

    // Show radius dropdown now that we have coords
    document.getElementById('radius-selector').style.display = '';

    state.feedWindowEnd = null;
    await loadEvents();
  } else {
    statusEl.textContent = 'Location unavailable — please select your city above.';
  }
  btn.disabled = false;
}

// ---------------------------------------------------------------
// Event detail modal
// ---------------------------------------------------------------
function openEventModal(eventId, prefetched) {
  // Use prefetched data or look up in state
  const event = prefetched ?? state.events.find((e) => e.id === eventId)
                           ?? state.calEvents.find((e) => e.id === eventId);
  if (!event) return;

  const city   = state.cities.find((c) => c.id === event.city_id);
  const styles = (event.dance_style_ids ?? [])
    .map((id) => state.danceStyles.find((s) => s.id === id))
    .filter(Boolean);
  const cost = costLabel(event);

  // Date/time block — include end time when available
  const dateStr = fmtDateLong(event.start_at);
  const timeStr = fmtTime(event.start_at) +
    (event.end_at ? ` – ${fmtTime(event.end_at)}` : '');

  // Address / map block
  let addressBlock;
  if (event.is_private) {
    addressBlock = `
      <p class="modal-detail">📍 <strong>${city?.name ?? ''}</strong>
        <em style="color:var(--muted)">&nbsp;(private venue — contact organizer for address)</em>
      </p>`;
  } else {
    const addrParts = [event.address, city?.name].filter(Boolean);
    const mapsQuery = encodeURIComponent(addrParts.join(', '));
    addressBlock = `
      <p class="modal-detail">📍 ${addrParts.join(', ')}
        <a href="https://maps.google.com/?q=${mapsQuery}" target="_blank"
           rel="noopener noreferrer" class="map-link">&nbsp;Map ↗</a>
      </p>`;
  }

  // Organizer block — always show name; linked contact button based on type
  let organizerBlock = '';
  if (event.organizer_name || event.organizer_contact) {
    const contactLink = buildOrganizerLink(event);
    organizerBlock = `
      <div class="modal-organizer">
        ${event.organizer_name
          ? `<p class="modal-detail">👤 <strong>${event.organizer_name}</strong></p>` : ''}
        ${contactLink ? `<div style="margin-top:.4rem">${contactLink}</div>` : ''}
      </div>`;
  }

  // Cost row — badge + optional tooltip
  const costRow = `
    <p class="modal-detail">
      <span class="tag ${cost.cls}">${cost.text}</span>
      ${costTooltipHtml(event.cost_notes)}
    </p>`;

  // External link
  const externalLink = event.external_link
    ? `<a href="${event.external_link}" target="_blank" rel="noopener noreferrer"
          class="btn btn--secondary btn--sm">More Info / Tickets ↗</a>`
    : '';

  document.getElementById('modal-content').innerHTML = `
    <h2 id="modal-event-name">${event.name}</h2>
    <p class="modal-date">${dateStr}</p>
    <p class="modal-time">${timeStr}</p>

    ${addressBlock}
    ${organizerBlock}

    <div class="modal-styles" style="margin:.75rem 0; display:flex; flex-wrap:wrap; gap:.35rem;">
      ${styles.map((s) => `<span class="tag tag--style">${s.name}</span>`).join('')}
    </div>

    ${costRow}

    ${event.description
      ? `<p class="modal-description">${event.description}</p>` : ''}

    ${externalLink
      ? `<div style="margin-top:.75rem">${externalLink}</div>` : ''}

    <div class="modal-actions">
      <button class="btn btn--secondary btn--sm" id="add-to-cal-btn">📅 Add to Calendar</button>
      <button class="btn btn--secondary btn--sm" id="share-event-btn">🔗 Copy Link</button>
    </div>
  `;

  const overlay = document.getElementById('event-modal');
  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add('is-open'));

  // Focus management — trap focus inside modal
  overlay.querySelector('.modal__close').focus();

  // Update URL for shareability + update OG meta for link previews
  const eventUrl = `${location.origin}/event/${event.id}`;
  history.replaceState({ eventId: event.id }, '', `/event/${event.id}`);

  updateOgMeta({
    title:       `${event.name} — CubanSocial`,
    description: event.description
      ? event.description.slice(0, 160)
      : `${styles.map((s) => s.name).join(', ')} event in ${city?.name ?? ''}.`,
    url:   eventUrl,
    image: event.media_url ?? '',
  });

  // Wire up action buttons
  document.getElementById('add-to-cal-btn').addEventListener('click', () => {
    downloadIcs(event, city);
  });
  document.getElementById('share-event-btn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(eventUrl);
      showToast('Link copied!');
    } catch {
      showToast('Could not copy link — try manually from the address bar.', 'error');
    }
  });
}

function closeEventModal() {
  const overlay = document.getElementById('event-modal');
  overlay.classList.remove('is-open');
  setTimeout(() => { overlay.hidden = true; }, 220);
  history.replaceState(null, '', '/');
  resetOgMeta();
}

// ---------------------------------------------------------------
// View toggle (Grid ↔ Calendar)
// ---------------------------------------------------------------
function setViewMode(mode) {
  state.viewMode = mode;

  const gridSection = document.getElementById('grid-section');
  const calSection  = document.getElementById('calendar-section');
  const gridBtn     = document.getElementById('view-grid-btn');
  const calBtn      = document.getElementById('view-calendar-btn');

  if (mode === 'grid') {
    gridSection.hidden = false;
    calSection.hidden  = true;
    gridBtn.classList.add('is-active');    gridBtn.setAttribute('aria-pressed', 'true');
    calBtn.classList.remove('is-active');  calBtn.setAttribute('aria-pressed', 'false');
  } else {
    gridSection.hidden = true;
    calSection.hidden  = false;
    gridBtn.classList.remove('is-active'); gridBtn.setAttribute('aria-pressed', 'false');
    calBtn.classList.add('is-active');     calBtn.setAttribute('aria-pressed', 'true');
    loadCalendarEvents();
  }
}

// ---------------------------------------------------------------
// Calendar view — event loading
// ---------------------------------------------------------------
async function loadCalendarEvents() {
  document.getElementById('cal-loading').hidden = false;
  document.getElementById('cal-grid-container').innerHTML = '';
  document.getElementById('cal-day-panel').hidden = true;

  // Load all events for the displayed month
  const firstDay = new Date(state.calYear, state.calMonth, 1);
  const lastDay  = new Date(state.calYear, state.calMonth + 1, 0, 23, 59, 59);

  const { data, error } = await buildFilteredQuery(firstDay, lastDay).limit(500);

  document.getElementById('cal-loading').hidden = true;

  if (error) {
    console.error('[CubanSocial] loadCalendarEvents error:', error);
    document.getElementById('cal-grid-container').innerHTML =
      '<p class="state-message">Failed to load calendar. Please try again.</p>';
    return;
  }

  state.calEvents = data ?? [];
  renderCalendar();
}

/**
 * Builds a Map<'YYYY-MM-DD', Event[]> from an events array.
 * Defaults to state.calEvents. Accepts an explicit array for testing.
 * @param {Array} [events]
 */
function buildEventsByDate(events = state.calEvents) {
  const map = new Map();
  for (const ev of events) {
    const key = ev.start_at.slice(0, 10); // 'YYYY-MM-DD'
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(ev);
  }
  return map;
}

/** Returns a color for a calendar dot based on event properties. */
function dotColor(event) {
  if (event.is_featured) return 'var(--yellow)';
  if (event.event_type === 'congress_national' ||
      event.event_type === 'congress_international') return 'var(--red)';
  if (event.is_private) return 'var(--muted)';
  return 'var(--blue)';
}

// ---------------------------------------------------------------
// Calendar view — month grid renderer (desktop)
// ---------------------------------------------------------------
function renderMonthGrid(eventsByDate) {
  const container = document.getElementById('cal-grid-container');
  container.innerHTML = '';

  const monthNames = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];
  document.getElementById('cal-title').textContent =
    `${monthNames[state.calMonth]} ${state.calYear}`;

  const grid = document.createElement('div');
  grid.className = 'cal-grid';
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-label', `${monthNames[state.calMonth]} ${state.calYear}`);

  // Day-of-week header row
  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach((day) => {
    const cell = document.createElement('div');
    cell.className = 'cal-weekday';
    cell.setAttribute('role', 'columnheader');
    cell.textContent = day;
    grid.appendChild(cell);
  });

  // Determine first cell offset (0 = Sun)
  const firstDow  = new Date(state.calYear, state.calMonth, 1).getDay();
  const daysInMo  = new Date(state.calYear, state.calMonth + 1, 0).getDate();
  const todayStr  = new Date().toISOString().slice(0, 10);

  // Pad empty cells before the 1st
  for (let i = 0; i < firstDow; i++) {
    const blank = document.createElement('div');
    blank.className = 'cal-day cal-day--empty';
    blank.setAttribute('role', 'gridcell');
    blank.setAttribute('aria-hidden', 'true');
    grid.appendChild(blank);
  }

  for (let d = 1; d <= daysInMo; d++) {
    const dateStr = `${state.calYear}-${String(state.calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayEvents = eventsByDate.get(dateStr) ?? [];
    const isToday   = dateStr === todayStr;
    const isSelected = dateStr === state.calSelectedDay;

    const cell = document.createElement('div');
    cell.className = [
      'cal-day',
      isToday    ? 'cal-day--today'    : '',
      isSelected ? 'cal-day--selected' : '',
      dayEvents.length ? 'cal-day--has-events' : '',
    ].filter(Boolean).join(' ');
    cell.setAttribute('role', 'gridcell');
    cell.setAttribute('tabindex', dayEvents.length ? '0' : '-1');
    cell.dataset.date = dateStr;
    if (dayEvents.length) {
      cell.setAttribute('aria-label', `${d} ${monthNames[state.calMonth]}, ${dayEvents.length} event${dayEvents.length > 1 ? 's' : ''}`);
    }

    // Day number
    const numEl = document.createElement('span');
    numEl.className = 'cal-day__num';
    numEl.textContent = d;
    cell.appendChild(numEl);

    // Event dots (max 3, then +N)
    if (dayEvents.length) {
      const dotsEl = document.createElement('div');
      dotsEl.className = 'cal-day__dots';
      const show = dayEvents.slice(0, 3);
      show.forEach((ev) => {
        const dot = document.createElement('span');
        dot.className = 'cal-dot';
        dot.style.background = dotColor(ev);
        dotsEl.appendChild(dot);
      });
      if (dayEvents.length > 3) {
        const more = document.createElement('span');
        more.className = 'cal-dot cal-dot--more';
        more.textContent = `+${dayEvents.length - 3}`;
        dotsEl.appendChild(more);
      }
      cell.appendChild(dotsEl);
    }

    grid.appendChild(cell);
  }

  container.appendChild(grid);
}

// ---------------------------------------------------------------
// Calendar view — mobile 3-day strip renderer
// ---------------------------------------------------------------
function renderMobileStrip(eventsByDate) {
  const container = document.getElementById('cal-grid-container');
  container.innerHTML = '';

  const monthNames = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];
  document.getElementById('cal-title').textContent =
    `${monthNames[state.calMonth]} ${state.calYear}`;

  const strip = document.createElement('div');
  strip.className = 'cal-strip';

  // Show center day ± 1 day
  const center = state.calStripCenter;
  const todayStr = new Date().toISOString().slice(0, 10);

  for (let offset = -1; offset <= 1; offset++) {
    const d = new Date(center);
    d.setDate(d.getDate() + offset);
    const dateStr = d.toISOString().slice(0, 10);
    const dayEvents = eventsByDate.get(dateStr) ?? [];
    const isToday   = dateStr === todayStr;
    const isCenter  = offset === 0;

    const dayEl = document.createElement('div');
    dayEl.className = [
      'cal-strip-day',
      isCenter  ? 'cal-strip-day--center'  : '',
      isToday   ? 'cal-strip-day--today'   : '',
      dayEvents.length ? 'cal-strip-day--has-events' : '',
    ].filter(Boolean).join(' ');
    dayEl.dataset.date = dateStr;

    dayEl.innerHTML = `
      <span class="cal-strip-day__dow">${d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
      <span class="cal-strip-day__num">${d.getDate()}</span>
      <div class="cal-day__dots">
        ${dayEvents.slice(0, 3).map((ev) =>
          `<span class="cal-dot" style="background:${dotColor(ev)}"></span>`
        ).join('')}
        ${dayEvents.length > 3 ? `<span class="cal-dot cal-dot--more">+${dayEvents.length - 3}</span>` : ''}
      </div>
    `;
    strip.appendChild(dayEl);
  }

  container.appendChild(strip);

  // Touch / swipe support for advancing the strip
  let touchStartX = null;
  strip.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
  strip.addEventListener('touchend', (e) => {
    if (touchStartX === null) return;
    const diff = e.changedTouches[0].clientX - touchStartX;
    touchStartX = null;
    if (Math.abs(diff) < 40) return; // ignore small swipes
    const newCenter = new Date(center);
    newCenter.setDate(newCenter.getDate() + (diff > 0 ? -1 : 1));
    state.calStripCenter = newCenter;
    state.calMonth = newCenter.getMonth();
    state.calYear  = newCenter.getFullYear();
    renderCalendar(); // re-render with same eventsByDate (no new fetch needed)
  }, { passive: true });
}

// ---------------------------------------------------------------
// Calendar view — day panel (events list for a selected day)
// ---------------------------------------------------------------
function showDayPanel(dateStr, dayEvents) {
  const panel = document.getElementById('cal-day-panel');

  const d = new Date(dateStr + 'T12:00:00');
  const label = d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  if (dayEvents.length === 0) {
    panel.innerHTML = `<p class="cal-day-panel__empty">No events on ${label}.</p>`;
    panel.hidden = false;
    return;
  }

  const items = dayEvents.map((ev) => `
    <li class="cal-day-event">
      <button class="cal-day-event__btn" data-action="view-event" data-event-id="${ev.id}">
        <span class="cal-day-event__time">${fmtTime(ev.start_at)}</span>
        <span class="cal-day-event__name">${ev.name}</span>
      </button>
    </li>
  `).join('');

  panel.innerHTML = `
    <h3 class="cal-day-panel__title">${label}</h3>
    <ul class="cal-day-events" role="list">${items}</ul>
  `;
  panel.hidden = false;
}

// ---------------------------------------------------------------
// Calendar view — top-level render (picks grid vs strip by viewport)
// ---------------------------------------------------------------
function renderCalendar() {
  const eventsByDate = buildEventsByDate();
  const isMobile = window.matchMedia('(max-width: 600px)').matches;

  if (isMobile) {
    renderMobileStrip(eventsByDate);
  } else {
    renderMonthGrid(eventsByDate);
  }

  // Re-render the day panel if a day was already selected
  if (state.calSelectedDay) {
    const dayEvents = eventsByDate.get(state.calSelectedDay) ?? [];
    showDayPanel(state.calSelectedDay, dayEvents);
  }
}

// ---------------------------------------------------------------
// Submit event modal (Slice 2 keeps this as skeleton — full in Slice 3)
// ---------------------------------------------------------------
function openSubmitModal() {
  const modal = document.getElementById('submit-modal');
  modal.hidden = false;
  requestAnimationFrame(() => modal.classList.add('is-open'));
  renderSubmitFormFields();
}

function closeSubmitModal() {
  const modal = document.getElementById('submit-modal');
  modal.classList.remove('is-open');
  setTimeout(() => { modal.hidden = true; }, 220);
}

function renderSubmitFormFields() {
  const container = document.getElementById('event-form-fields');
  const cityOptions = state.cities
    .map((c) => `<option value="${c.id}">${c.name}, ${c.state}</option>`)
    .join('');
  const styleOptions = state.danceStyles
    .map((s) => `<option value="${s.id}">${s.name}</option>`)
    .join('');

  container.innerHTML = `
    <div style="display:grid; gap:1rem;">
      <div class="form-group">
        <label for="f-name">Event Name <span class="form-required" aria-label="required">*</span></label>
        <input type="text" id="f-name" name="name" required autocomplete="off" />
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
        <div class="form-group">
          <label for="f-start">Start Date &amp; Time <span class="form-required">*</span></label>
          <input type="datetime-local" id="f-start" name="start_at" required />
        </div>
        <div class="form-group">
          <label for="f-end">End Time (optional)</label>
          <input type="datetime-local" id="f-end" name="end_at" />
        </div>
      </div>
      <div class="form-group">
        <label for="f-city">City <span class="form-required">*</span></label>
        <select id="f-city" name="city_id" required>
          <option value="">Select city…</option>
          ${cityOptions}
        </select>
      </div>
      <div class="form-group">
        <label for="f-address">Address <span class="hint">(leave blank if private)</span></label>
        <input type="text" id="f-address" name="address" autocomplete="street-address" />
      </div>
      <div class="form-group">
        <label for="f-type">Event Type <span class="form-required">*</span></label>
        <select id="f-type" name="event_type" required>
          <option value="">Select…</option>
          <option value="studio_local">Studio / Org Event</option>
          <option value="social_local">Private Social</option>
          <option value="congress_national">National Congress</option>
          <option value="congress_international">International Congress</option>
        </select>
      </div>
      <div class="form-group">
        <label for="f-styles">Dance Styles <span class="form-required">*</span></label>
        <select id="f-styles" name="dance_style_ids" multiple required size="4">
          ${styleOptions}
        </select>
        <p class="hint">Hold Ctrl / Cmd to select multiple</p>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
        <div class="form-group">
          <label for="f-cost-type">Cost</label>
          <select id="f-cost-type" name="cost_type">
            <option value="free">Free</option>
            <option value="paid">Paid</option>
            <option value="potluck">Potluck</option>
            <option value="tips">Tips welcome</option>
            <option value="sliding_scale">Sliding Scale</option>
          </select>
        </div>
        <div class="form-group">
          <label for="f-cost-amount">Amount (if paid)</label>
          <input type="number" id="f-cost-amount" name="cost_amount" min="0" step="0.01" />
        </div>
      </div>
      <div class="form-group">
        <label for="f-description">Description</label>
        <textarea id="f-description" name="description" rows="4"></textarea>
      </div>
      <div class="form-group">
        <label for="f-organizer-name">Organizer Name</label>
        <input type="text" id="f-organizer-name" name="organizer_name" />
      </div>
      <div class="form-group">
        <label for="f-organizer-contact">Organizer Contact</label>
        <input type="text" id="f-organizer-contact" name="organizer_contact"
               placeholder="@handle, phone, or email" />
      </div>
      <div class="form-group">
        <label for="f-media-url">Event poster or post link (optional)</label>
        <input type="url" id="f-media-url" name="media_url" placeholder="https://…" />
        <p class="hint">Direct image URL or Instagram / Facebook link</p>
      </div>
      <div class="form-group">
        <label for="f-external-link">Tickets / Event page link (optional)</label>
        <input type="url" id="f-external-link" name="external_link" placeholder="https://…" />
      </div>
    </div>
  `;
}

async function handleSubmitEvent(e) {
  e.preventDefault();

  // Honeypot — silently discard if filled by a bot
  if (document.getElementById('hp-field')?.value) return;

  const form = e.target;
  const fd   = new FormData(form);
  const styleSelect = document.getElementById('f-styles');
  const styleIds = styleSelect
    ? [...styleSelect.selectedOptions].map((o) => o.value)
    : [];

  const payload = {
    name:              fd.get('name'),
    start_at:          fd.get('start_at'),
    end_at:            fd.get('end_at') || null,
    city_id:           fd.get('city_id'),
    address:           fd.get('address') || null,
    event_type:        fd.get('event_type'),
    dance_style_ids:   styleIds,
    cost_type:         fd.get('cost_type') ?? 'free',
    cost_amount:       fd.get('cost_amount') ? parseFloat(fd.get('cost_amount')) : null,
    description:       fd.get('description') || null,
    organizer_name:    fd.get('organizer_name') || null,
    organizer_contact: fd.get('organizer_contact') || null,
    media_url:         fd.get('media_url') || null,
    external_link:     fd.get('external_link') || null,
    status:            'pending',
    source:            'manual_form',
    raw_submission_text: document.getElementById('paste-textarea')?.value || null,
  };

  const btn = form.querySelector('[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  const { error } = await db.from('events').insert([payload]);
  btn.disabled = false;
  btn.textContent = 'Submit Event';

  if (error) {
    showToast('Submission failed — please try again.', 'error');
    console.error('[CubanSocial] submit error:', error);
    return;
  }

  showToast('Thank you! Your event is under review.');
  closeSubmitModal();
  form.reset();
}

// ---------------------------------------------------------------
// Parse paste text
// ---------------------------------------------------------------
function handleParse() {
  const raw    = document.getElementById('paste-textarea')?.value ?? '';
  const parsed = parseEventText(raw, state.cities, state.danceStyles);
  const status = document.getElementById('parse-status');
  const aiBtn  = document.getElementById('ai-assist-btn');

  if (parsed._filledCount >= 3) {
    if (parsed.start_at) {
      const dt = document.getElementById('f-start');
      if (dt) dt.value = parsed.start_at.slice(0, 16);
    }
    if (parsed.city_id) {
      const cs = document.getElementById('f-city');
      if (cs) cs.value = parsed.city_id;
    }
    if (parsed.address) {
      const addr = document.getElementById('f-address');
      if (addr) addr.value = parsed.address;
    }
    if (parsed.cost_type) {
      const ct = document.getElementById('f-cost-type');
      if (ct) ct.value = parsed.cost_type;
    }
    if (parsed.cost_amount) {
      const ca = document.getElementById('f-cost-amount');
      if (ca) ca.value = parsed.cost_amount;
    }
    status.textContent = '✅ Fields pre-filled — review and submit!';
    aiBtn.hidden = true;
  } else {
    status.textContent = `Parsed ${parsed._filledCount}/3 required fields. Try AI Assist for better results.`;
    aiBtn.hidden = false;
  }
}

// ---------------------------------------------------------------
// Submit modal tabs
// ---------------------------------------------------------------
function initSubmitTabs() {
  const tabPaste    = document.getElementById('tab-paste');
  const tabManual   = document.getElementById('tab-manual');
  const panelPaste  = document.getElementById('panel-paste');
  const panelManual = document.getElementById('panel-manual');

  tabPaste.addEventListener('click', () => {
    tabPaste.classList.add('is-active');       tabPaste.setAttribute('aria-selected', 'true');
    tabManual.classList.remove('is-active');   tabManual.setAttribute('aria-selected', 'false');
    panelPaste.hidden = false;
    panelManual.hidden = true;
  });
  tabManual.addEventListener('click', () => {
    tabManual.classList.add('is-active');      tabManual.setAttribute('aria-selected', 'true');
    tabPaste.classList.remove('is-active');    tabPaste.setAttribute('aria-selected', 'false');
    panelManual.hidden = false;
    panelPaste.hidden = true;
  });
}

// ---------------------------------------------------------------
// Handle deep-link: /event/{id} (with GitHub Pages 404→?path= redirect)
// ---------------------------------------------------------------
async function handleDeepLink() {
  // GitHub Pages 404.html redirects /event/{id} → /?path=%2Fevent%2F{id}
  const params       = new URLSearchParams(location.search);
  const redirectPath = params.get('path');

  if (redirectPath) {
    // Restore the pretty URL without reloading
    history.replaceState(null, '', redirectPath);
  }

  // Check for /event/{id} in either the restored path or the original URL
  const checkPath = redirectPath ?? location.pathname;
  const match     = checkPath.match(/\/event\/([^/?#]+)/);
  if (!match) return;

  const targetId = match[1];

  // Try to find the event in already-loaded state
  let found = state.events.find((e) => e.id === targetId)
           ?? state.calEvents.find((e) => e.id === targetId);

  if (!found) {
    // Event not yet in state — fetch it directly
    const { data } = await db
      .from('events')
      .select('*')
      .eq('id', targetId)
      .eq('status', 'approved')
      .single();
    if (data) {
      found = data;
      // Add to state so the modal can resolve city / style lookups
      state.events.push(data);
    }
  }

  if (found) openEventModal(targetId, found);
}

// ---------------------------------------------------------------
// App bootstrap
// ---------------------------------------------------------------
async function init() {
  await loadReferenceData();
  populateCitySelector();
  populateStyleFilter();
  initRadiusSelector();

  // Load events for the initial window
  state.feedWindowEnd = null;
  await loadEvents();

  // --- Global event delegation ---
  document.addEventListener('click', (e) => {
    // "View Details" buttons on event cards + calendar day-event buttons
    const actionEl = e.target.closest('[data-action="view-event"]');
    if (actionEl) {
      const eventId = actionEl.dataset.eventId
                   ?? actionEl.closest('[data-event-id]')?.dataset.eventId;
      if (eventId) openEventModal(eventId);
      return;
    }
  });

  // --- Calendar grid: day-cell click ---
  document.getElementById('cal-grid-container').addEventListener('click', (e) => {
    const cell = e.target.closest('[data-date]');
    if (!cell || !cell.classList.contains('cal-day--has-events') &&
                 !cell.classList.contains('cal-strip-day--has-events')) return;

    const dateStr = cell.dataset.date;
    state.calSelectedDay = dateStr;

    // Remove 'selected' highlight from previous cell, add to new one
    document.querySelectorAll('.cal-day--selected, .cal-strip-day--selected').forEach((el) => {
      el.classList.remove('cal-day--selected', 'cal-strip-day--selected');
    });
    cell.classList.add(
      cell.classList.contains('cal-strip-day') ? 'cal-strip-day--selected' : 'cal-day--selected'
    );

    const dayEvents = state.calEvents.filter((ev) => ev.start_at.startsWith(dateStr));
    showDayPanel(dateStr, dayEvents);
  });

  // Keyboard support for calendar cells
  document.getElementById('cal-grid-container').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.target.click();
    }
  });

  // --- Close modals ---
  document.getElementById('modal-close-btn').addEventListener('click', closeEventModal);
  document.getElementById('submit-modal-close').addEventListener('click', closeSubmitModal);
  document.getElementById('cancel-submit-btn').addEventListener('click', closeSubmitModal);

  document.getElementById('event-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeEventModal();
  });
  document.getElementById('submit-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSubmitModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeEventModal(); closeSubmitModal(); }
  });

  // --- Submit event CTA ---
  document.getElementById('submit-event-cta').addEventListener('click', (e) => {
    e.preventDefault();
    openSubmitModal();
  });

  // --- Submit form ---
  document.getElementById('event-form').addEventListener('submit', handleSubmitEvent);

  // --- Parse button ---
  document.getElementById('parse-btn')?.addEventListener('click', handleParse);

  // --- Location button ---
  document.getElementById('allow-location-btn').addEventListener('click', handleLocationRequest);

  // --- City selector ---
  document.getElementById('city-select').addEventListener('change', async (e) => {
    state.selectedCityId = e.target.value;
    saveCity(e.target.value);
    state.feedWindowEnd = null;
    state.userCoords = null; // manual selection overrides geolocation
    document.getElementById('radius-selector').style.display = 'none';
    if (state.viewMode === 'grid')      { await loadEvents(); }
    else                               { await loadCalendarEvents(); }
  });

  // --- Radius selector ---
  document.getElementById('filter-radius').addEventListener('change', async (e) => {
    state.selectedRadius = parseInt(e.target.value, 10);
    saveRadius(state.selectedRadius);
    state.feedWindowEnd = null;
    if (state.viewMode === 'grid')      { await loadEvents(); }
    else                               { await loadCalendarEvents(); }
  });

  // --- Dance style filter ---
  document.getElementById('filter-style').addEventListener('change', async (e) => {
    state.filterStyle = e.target.value;
    state.feedWindowEnd = null;
    if (state.viewMode === 'grid')      { await loadEvents(); }
    else                               { await loadCalendarEvents(); }
  });

  // --- Event type filter ---
  document.getElementById('filter-type').addEventListener('change', async (e) => {
    state.filterType = e.target.value;
    state.feedWindowEnd = null;
    if (state.viewMode === 'grid')      { await loadEvents(); }
    else                               { await loadCalendarEvents(); }
  });

  // --- Date range filters ---
  document.getElementById('filter-date-from').addEventListener('change', async (e) => {
    state.filterDateFrom = e.target.value;
    state.feedWindowEnd  = null;
    if (state.viewMode === 'grid')      { await loadEvents(); }
    else                               { await loadCalendarEvents(); }
  });
  document.getElementById('filter-date-to').addEventListener('change', async (e) => {
    state.filterDateTo  = e.target.value;
    state.feedWindowEnd = null;
    if (state.viewMode === 'grid')      { await loadEvents(); }
    else                               { await loadCalendarEvents(); }
  });

  // --- Featured filter ---
  document.getElementById('filter-featured').addEventListener('change', async (e) => {
    state.filterFeatured = e.target.checked;
    state.feedWindowEnd  = null;
    if (state.viewMode === 'grid')      { await loadEvents(); }
    else                               { await loadCalendarEvents(); }
  });

  // --- Load more ---
  document.getElementById('load-more-btn').addEventListener('click', async () => {
    const cur = state.feedWindowEnd ?? new Date();
    state.feedWindowEnd = new Date(cur.getTime() + 30 * 24 * 60 * 60 * 1000);
    await loadEvents(false);
  });

  // --- View toggle ---
  document.getElementById('view-grid-btn').addEventListener('click', () => setViewMode('grid'));
  document.getElementById('view-calendar-btn').addEventListener('click', () => setViewMode('calendar'));

  // --- Calendar navigation ---
  document.getElementById('cal-prev-btn').addEventListener('click', () => {
    state.calMonth -= 1;
    if (state.calMonth < 0) { state.calMonth = 11; state.calYear -= 1; }
    state.calSelectedDay  = null;
    state.calStripCenter  = new Date(state.calYear, state.calMonth, 1);
    loadCalendarEvents();
  });
  document.getElementById('cal-next-btn').addEventListener('click', () => {
    state.calMonth += 1;
    if (state.calMonth > 11) { state.calMonth = 0; state.calYear += 1; }
    state.calSelectedDay  = null;
    state.calStripCenter  = new Date(state.calYear, state.calMonth, 1);
    loadCalendarEvents();
  });
  document.getElementById('cal-today-btn').addEventListener('click', () => {
    const now = new Date();
    state.calYear         = now.getFullYear();
    state.calMonth        = now.getMonth();
    state.calStripCenter  = now;
    state.calSelectedDay  = null;
    loadCalendarEvents();
  });

  // --- Submit tabs ---
  initSubmitTabs();

  // --- Re-render calendar on window resize (grid ↔ strip) ---
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.viewMode === 'calendar') renderCalendar();
    }, 250);
  });

  // --- Handle deep-link on page load (must run after events are in state) ---
  await handleDeepLink();
}

// Skip auto-init during Vitest runs so tests can import pure helpers cleanly.
if (import.meta.env?.MODE !== 'test') {
  init().catch(console.error);
}

// ---------------------------------------------------------------------------
// Named exports — pure helpers for unit testing.
// The rest of this module is DOM-coupled and tested via integration tests.
// ---------------------------------------------------------------------------
export {
  // formatting
  fmtEventDate,
  fmtTime,
  fmtDateLong,
  // cost badge
  costLabel,
  costTooltipHtml,
  // organizer contact link
  buildOrganizerLink,
  // calendar helpers
  buildEventsByDate,
  dotColor,
  // OG meta (DOM side-effect, testable via jsdom)
  updateOgMeta,
  // card renderer (DOM side-effect, testable via jsdom)
  renderCard,
  // mutable state — tests can seed it before calling DOM functions
  state,
};
