/**
 * CubanSocial — Admin Dashboard JS
 * Handles: auth, pending queue, approve/reject/edit, Instagram draft, WA reminder draft.
 */

import { db }                from './config.js';
import { generateInstagramDraft } from './instagram.js';

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function fmtDate(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleDateString('en-US', {
    weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit',
  });
}

// ---------------------------------------------------------------
// Reference data (loaded once after auth)
// ---------------------------------------------------------------
let cities      = [];
let danceStyles = [];

async function loadRef() {
  const [c, s] = await Promise.all([
    db.from('cities').select('*').eq('is_active', true),
    db.from('dance_styles').select('*').order('name'),
  ]);
  cities      = c.data ?? [];
  danceStyles = s.data ?? [];
}

// ---------------------------------------------------------------
// WhatsApp reminder draft
// ---------------------------------------------------------------
function buildReminderDraft(event, city, styles) {
  const dateStr = fmtDate(event.start_at);
  const styleNames = styles.map((s) => s.name).join(', ');
  const loc = event.is_private
    ? city?.name ?? ''
    : [event.address, city?.name].filter(Boolean).join(', ');
  return [
    `💃 *${event.name}*`,
    `📅 ${dateStr}`,
    `📍 ${loc}`,
    styleNames ? `🎵 ${styleNames}` : '',
    event.cost_type === 'free' ? '🎉 Free entrance' : event.cost_amount ? `💵 $${event.cost_amount}` : '',
    '',
    `More info: https://cubansocial.com/event/${event.id}`,
  ].filter((l) => l !== null && l !== '').join('\n');
}

// ---------------------------------------------------------------
// Render pending queue
// ---------------------------------------------------------------
async function loadPending() {
  const { data, error } = await db
    .from('events')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  const list = document.getElementById('pending-list');
  const badge = document.getElementById('pending-count');

  if (error || !data?.length) {
    badge.textContent = '0';
    list.innerHTML = '<p style="padding:1.25rem; color:var(--muted);">No pending events.</p>';
    return;
  }
  badge.textContent = String(data.length);
  list.innerHTML = '';
  data.forEach((ev) => list.appendChild(buildPendingCard(ev)));
}

function buildPendingCard(ev) {
  const city = cities.find((c) => c.id === ev.city_id);
  const styles = (ev.dance_style_ids ?? [])
    .map((id) => danceStyles.find((s) => s.id === id))
    .filter(Boolean);

  const card = document.createElement('div');
  card.className = 'event-review-card';
  card.id = `pending-${ev.id}`;
  card.innerHTML = `
    <p class="event-review-card__title">${ev.name}</p>
    <p class="event-review-card__meta">
      ${fmtDate(ev.start_at)} · ${city?.name ?? '—'} · ${styles.map((s) => s.name).join(', ') || '—'}
    </p>
    <p class="event-review-card__meta">Submitted: ${fmtDate(ev.created_at)}</p>
    <div class="event-review-card__actions">
      <button class="btn btn--primary btn--sm" data-action="approve" data-id="${ev.id}">✓ Approve</button>
      <button class="btn btn--danger btn--sm"  data-action="reject"  data-id="${ev.id}">✗ Reject</button>
      <button class="btn btn--secondary btn--sm" data-action="edit" data-id="${ev.id}">✎ Edit</button>
    </div>
  `;
  return card;
}

// ---------------------------------------------------------------
// Render published list
// ---------------------------------------------------------------
async function loadPublished() {
  const { data } = await db
    .from('events')
    .select('*')
    .eq('status', 'approved')
    .order('start_at', { ascending: false })
    .limit(50);

  const list = document.getElementById('published-list');
  if (!data?.length) {
    list.innerHTML = '<p style="padding:1.25rem; color:var(--muted);">No published events.</p>';
    return;
  }
  list.innerHTML = '';
  data.forEach((ev) => list.appendChild(buildPublishedCard(ev)));
}

function buildPublishedCard(ev) {
  const city = cities.find((c) => c.id === ev.city_id);

  const card = document.createElement('div');
  card.className = 'event-review-card';
  card.id = `published-${ev.id}`;
  card.innerHTML = `
    <p class="event-review-card__title">${ev.name}</p>
    <p class="event-review-card__meta">${fmtDate(ev.start_at)} · ${city?.name ?? '—'}</p>
    <div class="event-review-card__actions">
      <button class="btn btn--secondary btn--sm" data-action="edit"      data-id="${ev.id}">✎ Edit</button>
      <button class="btn btn--secondary btn--sm" data-action="drafts"    data-id="${ev.id}">📋 Drafts</button>
      <button class="btn btn--danger btn--sm"    data-action="unpublish" data-id="${ev.id}">Unpublish</button>
    </div>
    <div id="drafts-${ev.id}" hidden></div>
  `;
  return card;
}

// ---------------------------------------------------------------
// Approve event
// ---------------------------------------------------------------
async function approveEvent(id) {
  const { data: session } = await db.auth.getSession();
  const adminId = session?.session?.user?.id;

  // Fetch the event to generate drafts
  const { data: ev } = await db.from('events').select('*').eq('id', id).single();
  if (!ev) return;

  const city   = cities.find((c) => c.id === ev.city_id);
  const styles = (ev.dance_style_ids ?? [])
    .map((sid) => danceStyles.find((s) => s.id === sid))
    .filter(Boolean);

  const instagramDraft = generateInstagramDraft(ev, city, styles);
  const reminderDraft  = buildReminderDraft(ev, city, styles);
  const isFeatured = ev.is_featured ||
    (ev.dance_style_ids ?? []).some((sid) => {
      const s = danceStyles.find((ds) => ds.id === sid);
      return s?.slug === 'timba';
    });

  const { error } = await db.from('events').update({
    status:           'approved',
    approved_at:      new Date().toISOString(),
    approved_by:      adminId ?? null,
    instagram_draft:  instagramDraft,
    is_featured:      isFeatured,
  }).eq('id', id);

  if (error) { showToast('Approval failed.', 'error'); return; }

  // Show drafts inline
  showToast(`"${ev.name}" approved!`);
  showDrafts(id, instagramDraft, reminderDraft);
  document.querySelector(`[data-action="approve"][data-id="${id}"]`)?.closest('.event-review-card')
    ?.remove();
  await loadPending();
  await loadPublished();
}

function showDrafts(eventId, instagramDraft, reminderDraft) {
  const container = document.getElementById(`drafts-${eventId}`);
  if (!container) return;
  container.hidden = false;
  container.innerHTML = `
    <div class="draft-panel">
      <h3>📸 Instagram Draft</h3>
      <textarea readonly>${instagramDraft}</textarea>
      <button class="btn btn--secondary btn--sm" style="margin-top:.5rem;"
        onclick="navigator.clipboard.writeText(this.previousElementSibling.value).then(()=>alert('Copied!'))">
        Copy Caption
      </button>
    </div>
    <div class="draft-panel">
      <h3>💬 WhatsApp Reminder Draft</h3>
      <textarea readonly>${reminderDraft}</textarea>
      <button class="btn btn--secondary btn--sm" style="margin-top:.5rem;"
        onclick="navigator.clipboard.writeText(this.previousElementSibling.value).then(()=>alert('Copied!'))">
        Copy Reminder
      </button>
    </div>
  `;
}

// ---------------------------------------------------------------
// Reject event
// ---------------------------------------------------------------
async function rejectEvent(id) {
  const { error } = await db.from('events').update({ status: 'rejected' }).eq('id', id);
  if (error) { showToast('Reject failed.', 'error'); return; }
  showToast('Event rejected.');
  await loadPending();
}

// ---------------------------------------------------------------
// Unpublish
// ---------------------------------------------------------------
async function unpublishEvent(id) {
  if (!confirm('Unpublish this event? It will be removed from the public feed.')) return;
  const { error } = await db.from('events').update({ status: 'rejected' }).eq('id', id);
  if (error) { showToast('Failed.', 'error'); return; }
  showToast('Event unpublished.');
  await loadPublished();
}

// ---------------------------------------------------------------
// Edit event modal (skeleton — full in Slice 5)
// ---------------------------------------------------------------
async function openEditModal(id) {
  const { data: ev } = await db.from('events').select('*').eq('id', id).single();
  if (!ev) return;

  const cityOptions = cities.map((c) =>
    `<option value="${c.id}" ${c.id === ev.city_id ? 'selected' : ''}>${c.name}, ${c.state}</option>`
  ).join('');
  const styleOptions = danceStyles.map((s) =>
    `<option value="${s.id}" ${(ev.dance_style_ids ?? []).includes(s.id) ? 'selected' : ''}>${s.name}</option>`
  ).join('');

  const form = document.getElementById('edit-form');
  form.innerHTML = `
    <input type="hidden" name="id" value="${ev.id}" />
    <div style="display:grid; gap:1rem; margin-top:1rem;">
      <div class="form-group">
        <label for="ef-name">Event Name</label>
        <input type="text" id="ef-name" name="name" value="${ev.name ?? ''}" required />
      </div>
      <div class="form-group">
        <label for="ef-start">Start Date & Time</label>
        <input type="datetime-local" id="ef-start" name="start_at" value="${ev.start_at?.slice(0,16) ?? ''}" required />
      </div>
      <div class="form-group">
        <label for="ef-city">City</label>
        <select id="ef-city" name="city_id"><option value="">Select…</option>${cityOptions}</select>
      </div>
      <div class="form-group">
        <label for="ef-address">Address</label>
        <input type="text" id="ef-address" name="address" value="${ev.address ?? ''}" />
      </div>
      <div class="form-group">
        <label for="ef-styles">Dance Styles</label>
        <select id="ef-styles" name="dance_style_ids" multiple size="4">${styleOptions}</select>
      </div>
      <div class="form-group">
        <label for="ef-desc">Description</label>
        <textarea id="ef-desc" name="description" rows="4">${ev.description ?? ''}</textarea>
      </div>
      <div class="form-group">
        <label for="ef-media">Media URL</label>
        <input type="url" id="ef-media" name="media_url" value="${ev.media_url ?? ''}" />
      </div>
      <label style="display:flex; align-items:center; gap:.5rem; font-weight:700;">
        <input type="checkbox" name="is_featured" ${ev.is_featured ? 'checked' : ''} />
        ⭐ Featured event
      </label>
      <label style="display:flex; align-items:center; gap:.5rem; font-weight:700;">
        <input type="checkbox" name="is_private" ${ev.is_private ? 'checked' : ''} />
        🔒 Private event
      </label>
      <div style="display:flex; gap:.75rem; flex-wrap:wrap; margin-top:.5rem;">
        <button type="submit" class="btn btn--primary">Save Changes</button>
        <button type="button" class="btn btn--secondary" id="cancel-edit-btn">Cancel</button>
      </div>
    </div>
  `;

  const overlay = document.getElementById('edit-modal');
  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  document.getElementById('cancel-edit-btn').addEventListener('click', closeEditModal);
}

function closeEditModal() {
  const overlay = document.getElementById('edit-modal');
  overlay.classList.remove('is-open');
  setTimeout(() => { overlay.hidden = true; }, 220);
}

async function handleEditSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const fd   = new FormData(form);
  const id   = fd.get('id');

  const styleSelect = form.querySelector('[name="dance_style_ids"]');
  const styleIds = [...styleSelect.selectedOptions].map((o) => o.value);

  const updates = {
    name:            fd.get('name'),
    start_at:        fd.get('start_at'),
    city_id:         fd.get('city_id'),
    address:         fd.get('address') || null,
    description:     fd.get('description') || null,
    media_url:       fd.get('media_url') || null,
    dance_style_ids: styleIds,
    is_featured:     form.querySelector('[name="is_featured"]').checked,
    is_private:      form.querySelector('[name="is_private"]').checked,
  };

  const { error } = await db.from('events').update(updates).eq('id', id);
  if (error) { showToast('Save failed.', 'error'); return; }
  showToast('Event updated.');
  closeEditModal();
  await loadPending();
  await loadPublished();
}

// ---------------------------------------------------------------
// Auth
// ---------------------------------------------------------------
async function handleLogin(e) {
  e.preventDefault();
  const email    = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');

  errEl.textContent = '';
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    errEl.textContent = 'Invalid email or password.';
    return;
  }
  showDashboard();
}

async function showDashboard() {
  const { data: { user } } = await db.auth.getUser();
  if (!user) return;

  document.getElementById('login-screen').hidden = true;
  document.getElementById('dashboard').hidden    = false;
  document.getElementById('admin-greeting').textContent = `👋 ${user.email}`;

  await loadRef();
  await loadPending();
  await loadPublished();
}

// ---------------------------------------------------------------
// Event delegation
// ---------------------------------------------------------------
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;
  if (action === 'approve')   await approveEvent(id);
  if (action === 'reject')    await rejectEvent(id);
  if (action === 'unpublish') await unpublishEvent(id);
  if (action === 'edit')      await openEditModal(id);
  if (action === 'drafts') {
    const { data: ev } = await db.from('events').select('*').eq('id', id).single();
    if (!ev) return;
    const city   = cities.find((c) => c.id === ev.city_id);
    const styles = (ev.dance_style_ids ?? []).map((sid) => danceStyles.find((s) => s.id === sid)).filter(Boolean);
    showDrafts(id, ev.instagram_draft ?? generateInstagramDraft(ev, city, styles), buildReminderDraft(ev, city, styles));
  }
});

document.getElementById('edit-modal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeEditModal();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeEditModal(); });

// ---------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------
document.getElementById('login-form').addEventListener('submit', handleLogin);
document.getElementById('edit-form').addEventListener('submit', handleEditSubmit);
document.getElementById('logout-btn')?.addEventListener('click', async () => {
  await db.auth.signOut();
  location.reload();
});

// Check existing session
db.auth.getSession().then(({ data }) => {
  if (data?.session) showDashboard();
});
