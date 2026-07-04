/**
 * CubanSocial — App entry point
 * Initialises: city selector, geolocation, event feed, modals, submit form.
 *
 * Walking skeleton: connects to Supabase, populates city dropdown,
 * loads approved events, renders cards, wires up filter bar.
 */

import { db }                        from './config.js';
import { requestGeolocation, nearestCity, citiesWithinRadius, saveCity, loadCity } from './geo.js';
import { parseEventText }            from './parser.js';
import { downloadIcs }               from './calendar.js';

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
let state = {
  cities:        [],
  danceStyles:   [],
  events:        [],
  featuredEvents:[],
  selectedCityId: null,
  userCoords:    null,
  showNearby:    false,
  filterStyle:   '',
  filterType:    '',
  filterDateFrom:'',
  filterDateTo:  '',
  filterFeatured: false,
  // Pagination: track the end of the current window
  feedWindowEnd: null,
};

// ---------------------------------------------------------------
// Toast
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
  return d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' }) +
         ' · ' +
         d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
}

function costLabel(event) {
  if (event.cost_type === 'free')    return { text: 'Free', cls: 'tag--free' };
  if (event.cost_type === 'potluck') return { text: 'Potluck', cls: 'tag--style' };
  if (event.cost_type === 'tips')    return { text: 'Tips', cls: 'tag--style' };
  if (event.cost_type === 'paid' && event.cost_amount)
    return { text: `$${event.cost_amount}`, cls: 'tag--paid' };
  return { text: event.cost_type, cls: 'tag--style' };
}

// ---------------------------------------------------------------
// Event card renderer
// ---------------------------------------------------------------
function renderCard(event) {
  const city   = state.cities.find((c) => c.id === event.city_id);
  const styles = (event.dance_style_ids ?? [])
    .map((id) => state.danceStyles.find((s) => s.id === id))
    .filter(Boolean);
  const cost   = costLabel(event);
  const featured = event.is_featured ? 'event-card--featured' : '';

  const mediaSrc = event.media_url && /\.(jpe?g|png|gif|webp)(\?.*)?$/i.test(event.media_url)
    ? event.media_url : null;

  const mediaHtml = mediaSrc
    ? `<img src="${mediaSrc}" alt="${event.name} event poster" loading="lazy" />`
    : `<span class="event-card__media-placeholder" aria-hidden="true">🎵</span>`;

  const styleChips = styles.map((s) =>
    `<span class="tag tag--style">${s.name}</span>`
  ).join('');

  const locationText = event.is_private
    ? `🔒 ${city?.name ?? ''} — Contact Organizer`
    : `${event.address ? event.address + ', ' : ''}${city?.name ?? ''}`;

  const article = document.createElement('article');
  article.className = `event-card ${featured}`;
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
        <span class="tag ${cost.cls}">${cost.text}</span>
        ${event.is_private ? '<span class="tag tag--private">🔒 Private</span>' : ''}
      </div>
    </div>
    <div class="event-card__footer">
      <button class="btn btn--secondary btn--sm" data-action="view-event" aria-label="View details for ${event.name}">
        View Details
      </button>
    </div>
  `;
  return article;
}

// ---------------------------------------------------------------
// Feed rendering
// ---------------------------------------------------------------
function renderFeed(events) {
  const grid     = document.getElementById('events-cards');
  const featGrid = document.getElementById('featured-cards');
  const featRow  = document.getElementById('featured-row');

  grid.innerHTML = '';
  featGrid.innerHTML = '';

  const featured = events.filter((e) => e.is_featured);
  const regular  = events;

  if (featured.length > 0) {
    featRow.hidden = false;
    featured.forEach((e) => featGrid.appendChild(renderCard(e)));
  } else {
    featRow.hidden = true;
  }

  if (regular.length === 0) {
    grid.innerHTML = '<p class="state-message">No events found. Try adjusting your filters.</p>';
    return;
  }
  regular.forEach((e) => grid.appendChild(renderCard(e)));
}

// ---------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------
async function loadReferenceData() {
  const [stylesRes, citiesRes] = await Promise.all([
    db.from('dance_styles').select('*').order('name'),
    db.from('cities').select('*').eq('is_active', true).order('name'),
  ]);
  if (stylesRes.data) state.danceStyles = stylesRes.data;
  if (citiesRes.data) state.cities      = citiesRes.data;
}

async function loadEvents() {
  const grid = document.getElementById('events-cards');
  grid.innerHTML = '<div class="state-message"><div class="spinner" aria-hidden="true"></div><p>Loading events…</p></div>';

  // Build 30-day window
  const from = new Date();
  const to   = state.feedWindowEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  state.feedWindowEnd = to;

  let query = db
    .from('events')
    .select('*')
    .eq('status', 'approved')
    .gte('start_at', from.toISOString())
    .lte('start_at', to.toISOString())
    .order('start_at', { ascending: true });

  // City filter
  if (state.selectedCityId) {
    if (state.showNearby && state.userCoords) {
      const nearby = citiesWithinRadius(state.userCoords, state.cities, 80);
      const ids = nearby.map((c) => c.id);
      if (ids.length) query = query.in('city_id', ids);
    } else {
      query = query.eq('city_id', state.selectedCityId);
    }
  }

  if (state.filterStyle)   query = query.contains('dance_style_ids', [state.filterStyle]);
  if (state.filterType)    query = query.eq('event_type', state.filterType);
  if (state.filterFeatured) query = query.eq('is_featured', true);
  if (state.filterDateFrom) query = query.gte('start_at', state.filterDateFrom);
  if (state.filterDateTo)   query = query.lte('start_at', state.filterDateTo + 'T23:59:59');

  const { data, error } = await query.limit(100);

  if (error) {
    grid.innerHTML = '<p class="state-message">Failed to load events. Please try again.</p>';
    console.error('[CubanSocial] loadEvents error:', error);
    return;
  }
  state.events = data ?? [];
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
  // Restore saved city
  const saved = loadCity();
  if (saved) { sel.value = saved; state.selectedCityId = saved; }
}

// ---------------------------------------------------------------
// Geolocation flow
// ---------------------------------------------------------------
async function handleLocationRequest() {
  const status  = document.getElementById('location-status');
  const btn     = document.getElementById('allow-location-btn');
  const citySelect = document.getElementById('city-select');

  status.textContent = 'Detecting your location…';
  btn.disabled = true;

  const coords = await requestGeolocation();
  if (coords) {
    state.userCoords = coords;
    const city = nearestCity(coords, state.cities, 30);
    if (city) {
      state.selectedCityId = city.id;
      citySelect.value = city.id;
      saveCity(city.id);
      status.textContent = `📍 Showing events in ${city.name}`;
      await loadEvents();
    } else {
      status.textContent = 'No city found nearby — please select manually.';
    }
  } else {
    status.textContent = 'Location unavailable — please select your city above.';
  }
  btn.disabled = false;
}

// ---------------------------------------------------------------
// Event detail modal
// ---------------------------------------------------------------
function openEventModal(eventId) {
  const event  = state.events.find((e) => e.id === eventId);
  if (!event) return;

  const city   = state.cities.find((c) => c.id === event.city_id);
  const styles = (event.dance_style_ids ?? [])
    .map((id) => state.danceStyles.find((s) => s.id === id))
    .filter(Boolean);
  const cost   = costLabel(event);

  const addressBlock = event.is_private
    ? `<p>📍 ${city?.name ?? ''} &nbsp;<em>(private venue)</em></p>
       <p><a href="mailto:${event.organizer_contact ?? ''}" class="btn btn--secondary btn--sm">Contact Organizer</a></p>`
    : `<p>📍 ${event.address ? event.address + ', ' : ''}${city?.name ?? ''}
         &nbsp;<a href="https://maps.google.com/?q=${encodeURIComponent((event.address ?? '') + ' ' + (city?.name ?? ''))}"
         target="_blank" rel="noopener">Map ↗</a></p>`;

  const externalLink = event.external_link
    ? `<p><a href="${event.external_link}" target="_blank" rel="noopener" class="btn btn--secondary btn--sm">More Info / Tickets ↗</a></p>`
    : '';

  document.getElementById('modal-content').innerHTML = `
    <h2 id="modal-event-name">${event.name}</h2>
    <p style="color:var(--blue); font-weight:700; margin:.5rem 0;">${fmtEventDate(event.start_at)}</p>
    ${addressBlock}
    <p style="margin:.5rem 0;">${styles.map((s) => `<span class="tag tag--style">${s.name}</span>`).join(' ')}&nbsp;
       <span class="tag ${cost.cls}">${cost.text}</span>${event.cost_notes ? ' — ' + event.cost_notes : ''}</p>
    ${event.description ? `<p style="margin:1rem 0; line-height:1.6;">${event.description}</p>` : ''}
    ${externalLink}
    <div style="margin-top:1rem; display:flex; gap:.75rem; flex-wrap:wrap;">
      <button class="btn btn--secondary btn--sm" id="add-to-cal-btn">📅 Add to Calendar</button>
      <button class="btn btn--secondary btn--sm" id="share-event-btn">🔗 Copy Link</button>
    </div>
  `;

  const overlay = document.getElementById('event-modal');
  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add('is-open'));

  // Update URL for shareability
  history.replaceState(null, '', `/event/${event.id}`);

  document.getElementById('add-to-cal-btn').addEventListener('click', () => {
    downloadIcs(event, city);
  });
  document.getElementById('share-event-btn').addEventListener('click', () => {
    const url = `${location.origin}/event/${event.id}`;
    navigator.clipboard?.writeText(url).then(() => showToast('Link copied!'));
  });
}

function closeEventModal() {
  const overlay = document.getElementById('event-modal');
  overlay.classList.remove('is-open');
  setTimeout(() => { overlay.hidden = true; }, 220);
  history.replaceState(null, '', '/');
}

// ---------------------------------------------------------------
// Submit event form (skeleton — full in Slice 3)
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
  // Populate city options for form
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
          <label for="f-start">Start Date & Time <span class="form-required">*</span></label>
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
            <option value="tips">Tips</option>
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
        <label for="f-organizer-contact">Organizer Contact (email, phone, or @handle)</label>
        <input type="text" id="f-organizer-contact" name="organizer_contact" />
      </div>
      <div class="form-group">
        <label for="f-media-url">Event poster or post link (optional)</label>
        <input type="url" id="f-media-url" name="media_url" placeholder="https://…" />
        <p class="hint">Direct image URL or Instagram/Facebook link</p>
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

  // Honeypot check
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
    // Pre-fill form
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
// Wire up tabs in submit modal
// ---------------------------------------------------------------
function initSubmitTabs() {
  const tabPaste   = document.getElementById('tab-paste');
  const tabManual  = document.getElementById('tab-manual');
  const panelPaste = document.getElementById('panel-paste');
  const panelManual= document.getElementById('panel-manual');

  tabPaste.addEventListener('click', () => {
    tabPaste.classList.add('is-active');  tabPaste.setAttribute('aria-selected', 'true');
    tabManual.classList.remove('is-active'); tabManual.setAttribute('aria-selected', 'false');
    panelPaste.hidden = false; panelManual.hidden = true;
  });
  tabManual.addEventListener('click', () => {
    tabManual.classList.add('is-active'); tabManual.setAttribute('aria-selected', 'true');
    tabPaste.classList.remove('is-active'); tabPaste.setAttribute('aria-selected', 'false');
    panelManual.hidden = false; panelPaste.hidden = true;
  });
}

// ---------------------------------------------------------------
// Populate dance style filter dropdown
// ---------------------------------------------------------------
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
// App bootstrap
// ---------------------------------------------------------------
async function init() {
  await loadReferenceData();
  populateCitySelector();
  populateStyleFilter();

  // Try to restore saved city and load events
  const saved = loadCity();
  if (saved) {
    state.selectedCityId = saved;
    await loadEvents();
  } else {
    await loadEvents(); // load all cities on first visit
  }

  // --- Event delegation: view-event buttons ---
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="view-event"]');
    if (btn) {
      const eventId = btn.closest('[data-event-id]')?.dataset.eventId;
      if (eventId) openEventModal(eventId);
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

  // Keyboard: Escape closes modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeEventModal(); closeSubmitModal(); }
  });

  // --- Submit event CTA ---
  document.getElementById('submit-event-cta').addEventListener('click', (e) => {
    e.preventDefault(); openSubmitModal();
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
    await loadEvents();
  });

  // --- Filters ---
  ['filter-style', 'filter-type', 'filter-date-from', 'filter-date-to'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', async (e) => {
      state[id.replace('filter-', 'filter').replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = e.target.value;
      state.feedWindowEnd = null;
      await loadEvents();
    });
  });

  document.getElementById('filter-featured')?.addEventListener('change', async (e) => {
    state.filterFeatured = e.target.checked;
    state.feedWindowEnd = null;
    await loadEvents();
  });

  document.getElementById('filter-nearby')?.addEventListener('change', async (e) => {
    state.showNearby = e.target.checked;
    state.feedWindowEnd = null;
    await loadEvents();
  });

  // --- Load more ---
  document.getElementById('load-more-btn')?.addEventListener('click', async () => {
    const cur = state.feedWindowEnd ?? new Date();
    state.feedWindowEnd = new Date(cur.getTime() + 30 * 24 * 60 * 60 * 1000);
    await loadEvents();
  });

  // --- Submit tabs ---
  initSubmitTabs();

  // --- Handle deep-link /event/{id} ---
  const pathMatch = location.pathname.match(/^\/event\/(.+)$/);
  if (pathMatch) {
    const targetId = pathMatch[1];
    const found = state.events.find((e) => e.id === targetId);
    if (found) openEventModal(targetId);
    else {
      // Event not in current window; fetch it directly
      const { data } = await db.from('events').select('*').eq('id', targetId).single();
      if (data) { state.events.push(data); openEventModal(targetId); }
    }
  }
}

init().catch(console.error);
