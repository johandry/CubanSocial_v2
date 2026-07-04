# CubanSocial — Agent Context File

> **Read this file at the start of every session.**
> It captures architecture decisions, conventions, current state, and the feature slice plan.

---

## What We're Building

**CubanSocial.com** — a free, mobile-first web app for discovering Latin/Cuban dance events (Timba, Salsa, Bachata, etc.) in California. Events are submitted by anyone, reviewed by admins, and published to a public feed.

**PRD:** `docs/PRD.md`

---

## Tech Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Frontend | Vanilla HTML + CSS + JS (ES Modules) | No framework. GitHub Pages hosting. |
| Database | Supabase (PostgreSQL) | Free tier: 500 MB, 50k rows |
| Auth | Supabase Auth | Email/password for admins only. No public accounts. |
| Edge Functions | Supabase (Deno) | `notify-admin`, `parse-event` |
| Scheduled jobs | Supabase `pg_cron` | Auto-archive + reminder draft emails |
| Email | Resend | Free tier, 3k emails/month |
| AI Parser | n8n Cloud → Gemini/OpenRouter | Via `parse-event` Edge Function proxy |
| Analytics | Umami Cloud | Privacy-first, no PII |
| Hosting | GitHub Pages | Auto-deploy via `.github/workflows/deploy.yml` |

---

## Repository Structure

```text
CubanSocialV2/
├── index.html                  # Main SPA (public event feed + submit form)
├── admin.html                  # Admin dashboard (auth-gated)
├── css/
│   ├── main.css                # All shared styles, design tokens, components
│   └── admin.css               # Admin-specific styles
├── js/
│   ├── config.js               # Supabase client (credentials injected at deploy)
│   ├── main.js                 # App entry point — feed, filters, modals, submit
│   ├── geo.js                  # Geolocation + Haversine distance utilities
│   ├── parser.js               # Client-side regex event text parser
│   ├── instagram.js            # Instagram caption draft generator
│   ├── calendar.js             # .ics file generator (Add to Calendar)
│   └── admin.js                # Admin dashboard logic
├── supabase/
│   ├── migrations/
│   │   ├── 001_initial_schema.sql   # Full schema + RLS (all PRD v1.2 fields)
│   │   └── 002_pg_cron_setup.sql   # pg_cron jobs (apply after enabling extension)
│   ├── seed.sql                     # Dance styles + cities seed data
│   ├── test-event.sql               # Verification helper — run after first deploy
│   └── functions/
│       ├── notify-admin/index.ts         # DB Webhook → Resend email to admins
│       ├── parse-event/index.ts          # Proxy to n8n AI Agent webhook
│       ├── send-reminder/index.ts        # [Slice 5] pg_cron → reminder draft emails to admins
│       └── generate-recurrences/index.ts # [Slice 5] Rolling generation of recurring event instances
├── docs/
│   └── PRD.md
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Pages deploy (injects Supabase secrets)
└── AGENTS.md                   # This file
```

---

## Design Tokens (CSS variables in `css/main.css`)

| Token | Value | Usage |
| --- | --- | --- |
| `--blue` | `#0066CC` | Primary brand, header, links |
| `--yellow` | `#FFD700` | CTA buttons, accents, featured badge |
| `--red` | `#CC2200` | Cuban red, danger actions, paid badge |
| `--green` | `#2D7A4F` | Free badge, success states |
| `--font-display` | `Righteous` (Google Fonts) | Headings, logo |
| `--font-body` | `Nunito` (Google Fonts) | All body text |

---

## Data Model Summary

### `dance_styles`

`id`, `name`, `slug`, `is_featured` — seed: Timba (featured), Salsa On1/On2, Bachata, Merengue, Cumbia, Cha-cha-chá, Mambo, Kizomba, Reggaeton, Guaracha, Son Cubano

### `cities`

`id`, `name`, `state`, `country`, `lat`, `lon`, `is_active` — seed: 8 California cities

### `events`

Core table. Key fields:

- `status`: `pending | approved | rejected | archived | cancelled` (`cancelled` used only for individual recurring event instances)
- `event_type`: `studio_local | social_local | congress_national | congress_international`
- `is_private`: hides street address on public feed (independent of event_type)
- `is_featured`: auto-set `true` when Timba is a selected dance style; admin-overridable
- `dance_style_ids`: `uuid[]` array FK to `dance_styles`
- `source`: `whatsapp_paste | whatsapp_paste_ai_assisted | manual_form | admin_direct`
- `instagram_draft`: generated on approval
- `cost_type`: `free | paid | potluck | tips | sliding_scale`
- `cost_notes`: optional text shown as `(?)` tooltip next to cost badge
- `organizer_contact`: handle/number; `organizer_contact_type`: `instagram | whatsapp | email | other`
- `recurrence_type`: `none | weekly | biweekly | monthly`
- `recurrence_end_at`: optional series end; null = rolling 12-week auto-generation
- `parent_event_id`: null on standalone/parent events; set on auto-generated child instances

### `admins`

Maps to Supabase Auth user IDs. Created manually in Supabase dashboard.

### `notification_log`

Audit trail for reminder drafts, instagram drafts, admin emails.

---

## RLS Rules

- `events`: Public can SELECT approved only; anyone can INSERT pending; admins via service role
- `dance_styles`, `cities`: Public SELECT; admin INSERT/UPDATE via service role
- `admins`: Own row only

---

## Key Architecture Decisions

1. **No public user accounts.** Only admins have Supabase Auth accounts.
2. **Client never holds secrets.** Supabase anon key (read-only) is the only credential in JS. n8n URL/token and Resend key live in Edge Function env secrets only.
3. **Geolocation:** Browser `navigator.geolocation` → Haversine (client-side JS) → nearest city < 30 mi. Fallback: manual city dropdown. Persisted in `localStorage` key `cubansocial_city`.
4. **Parser hierarchy:** regex first → if < 3 required fields filled → show "Try AI Assist" button → Edge Function proxy → n8n → Gemini. Max 2 clarification rounds. Silent fallback on timeout/error.
5. **Instagram draft:** Generated in `js/instagram.js` on admin approval. Admin copies manually.
6. **WhatsApp reminder:** pg_cron at 09:00 UTC queries events 3 days out; reminder draft delivered to admin by email (Resend). Admin posts manually.
7. **Auto-archive:** pg_cron at 00:05 UTC sets `status = 'archived'` for events > 60 days past start.
8. **Pagination:** feed loads approved events in 30-day windows. "Load more" extends window by 30 days.
9. **Featured badge:** Events with `is_featured = true` get a gold `⭐ Featured` badge on their card. All events — featured or not — appear in the **same grid**. A "Featured only" filter toggle (default: off) is available in the filter bar. Auto-featured when Timba is selected.
10. **Event detail URL:** `/event/{id}` — `history.replaceState` when modal opens; deep-link supported on page load.
11. **GitHub Pages deploy:** `deploy.yml` injects `SUPABASE_URL` and `SUPABASE_ANON_KEY` from GitHub Secrets via `sed` substitution into `js/config.js` at build time.

---

## Conventions

- **ES Modules** throughout (`type="module"` in HTML). No bundler.
- **One file per concern** in `js/`. Keep files focused.
- **Accessibility:** ARIA landmarks on all major sections; focus trap in modals; WCAG 2.1 AA contrast.
- **Mobile-first CSS.** Grid with `auto-fill` / `minmax(300px, 1fr)`. Breakpoint: 600px.
- **No inline event handlers** in JS-generated HTML except where unavoidable (admin drafts copy buttons — acceptable).
- **Error handling:** Always show user-facing toast on DB errors. Log raw errors to `console.error`.
- **Honeypot:** `<input name="website" id="hp-field">` hidden field in submit form. If filled, silently discard submission.
- **Security:** All secrets in Edge Function env or GitHub Secrets. Never in source. Validate `origin` header in `parse-event` Edge Function. Supabase RLS is the primary data-layer guard.

---

## Feature Slices

Work through slices in order. Each slice is self-contained and produces a shippable increment.

### ✅ Slice 0 — Walking Skeleton (DONE)

- [x] Directory scaffold
- [x] `index.html` full layout shell (header, hero, filter bar, feed, footer)
- [x] `admin.html` login + dashboard shell
- [x] `css/main.css` + `css/admin.css` with full design tokens
- [x] `js/config.js` Supabase client (placeholders)
- [x] `js/main.js` — app bootstrap, city selector, feed loader, event cards, modals, submit form skeleton
- [x] `js/geo.js` — Haversine + geolocation
- [x] `js/parser.js` — regex event text parser
- [x] `js/instagram.js` — caption draft generator
- [x] `js/calendar.js` — .ics generator
- [x] `js/admin.js` — admin auth, pending/published lists, approve/reject/edit, draft panels
- [x] `supabase/migrations/001_initial_schema.sql`
- [x] `supabase/seed.sql`
- [x] `supabase/functions/notify-admin/index.ts`
- [x] `supabase/functions/parse-event/index.ts`
- [x] `.github/workflows/deploy.yml`

**Next:** Connect to a real Supabase project, apply migration + seed, set GitHub Secrets, deploy.

---

### ✅ Slice 1 — Supabase Setup & First Deploy (DONE)

**Goal:** Live GitHub Pages site connected to real Supabase.

Tasks:

- [x] Create Supabase project (free tier)
- [x] Apply `001_initial_schema.sql` in Supabase SQL editor
- [x] Run `seed.sql`
- [x] Enable `pg_cron` extension in Supabase dashboard
- [x] Set up Supabase Database Webhook → `notify-admin` function on `INSERT events`
- [x] Set Edge Function env secrets: `RESEND_API_KEY`, `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`
- [x] Set GitHub repository secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- [x] Configure GitHub Pages in repo settings (source: GitHub Actions)
- [x] Push to `main` → verify deploy at `https://<user>.github.io/CubanSocialV2/`
- [x] Manually insert one test event in Supabase and verify it appears on the live feed

---

### 🔲 Slice 2 — Public Event Feed (Polish)

**Goal:** Feed is fully functional with all filters, geolocation, and event detail modal.

Tasks:

- [ ] Verify geolocation → auto-select nearest city
- [ ] Verify radius dropdown (10 mi / 25 mi / 50 mi / 80 mi / Any)
- [ ] Verify filter by dance style, event type, date range, featured
- [ ] Featured badge on cards; "Featured only" toggle (off by default); all events in same grid
- [ ] Grid / Calendar view toggle; month grid with event dots; day-click list panel; mobile 3-day strip
- [ ] Cost notes `(?)` tooltip on cards and event detail modal
- [ ] Event card — all card types: studio_local, social_local private, congress
- [ ] Event detail modal: full info, Google Maps link, organizer contact link (Instagram/WhatsApp), Add to Calendar (.ics), Copy Link
- [ ] Deep-link `/event/{id}` — reload page on event URL → opens modal
- [ ] OG meta tags updated per-event when modal opens (`og:title`, `og:description`, `og:image`)
- [ ] "Load more" (next 30-day window)
- [ ] Empty state and loading spinner
- [ ] Mobile responsive audit

---

### 🔲 Slice 3 — Submit Event Form

**Goal:** Visitors can submit events; admins are notified.

Tasks:

- [ ] Two-tab form: Paste Text | Fill Manually
- [ ] Parse button: runs `parseEventText()`, pre-fills form, shows AI Assist if < 3 fields
- [ ] Recurrence fields in submit form: `recurrence_type` selector, optional `recurrence_end_at` date
- [ ] "Try AI Assist" button → calls `parse-event` Edge Function → fills form or shows clarification questions
- [ ] Max 2 clarification rounds; silent fallback on error
- [ ] All required fields validated client-side before submit
- [ ] Honeypot check
- [ ] Submit to Supabase `events` table
- [ ] Confirmation toast
- [ ] Admin email notification via `notify-admin` Edge Function

---

### 🔲 Slice 4 — Admin Dashboard (Full)

**Goal:** Admins can manage all events efficiently.

Tasks:

- [ ] Supabase Auth login (email + password)
- [ ] Pending queue with badge count; real-time updates via Supabase Realtime
- [ ] Approve → sets `status = 'approved'`, generates `instagram_draft`, marks Timba events featured, triggers `generate-recurrences` if recurring
- [ ] Reject → removes from queue
- [ ] Edit modal — all fields editable; approved events stay live immediately
- [ ] Recurring series view: children grouped under parent; per-instance cancel; cancel-all-future; edit-series propagation
- [ ] Instagram draft panel with Copy button
- [ ] WhatsApp reminder draft panel with Copy button
- [ ] Published list: edit / unpublish / view drafts
- [ ] Featured toggle in edit form

---

### 🔲 Slice 5 — Notifications & Automation

**Goal:** pg_cron jobs running; Resend email working.

Tasks:

- [ ] Resend account + `noreply@cubansocial.com` sending domain verified
- [ ] `notify-admin` Edge Function tested end-to-end (submit event → admin email)
- [ ] `send-reminder` Edge Function deployed and tested (pg_net + pg_cron → reminder email 3 days before event)
- [ ] `generate-recurrences` Edge Function deployed and tested (creates child instances on approval; weekly rolling job)
- [ ] `pg_cron` auto-archive job verified (manually set event start_at 61 days ago → confirm archived)
- [ ] `pg_cron` reminder job verified (event 3 days out with reminder_sent_at IS NULL → email sent)
- [ ] Recurring event series: create parent, approve, verify 12-week instance generation, test single-instance cancel
- [ ] `notification_log` entries created for reminder_draft and admin_email types

---

### 🔲 Slice 6 — Polish, QA & Analytics

**Goal:** Production-ready.

Tasks:

- [ ] Umami Cloud account + site ID; uncomment script tag in `index.html`
- [ ] Track: filter usage, "Try AI Assist" clicks, event card clicks, modal opens
- [ ] WCAG 2.1 AA audit: color contrast, keyboard navigation, focus trap in modals, ARIA landmarks
- [ ] Performance audit: < 2 s mobile (3G) — check font loading, image lazy load
- [ ] Cross-browser test: Chrome, Firefox, Safari iOS
- [ ] Set custom domain in GitHub Pages (CNAME `cubansocial.com`)
- [ ] CNAME record in DNS: `www CNAME <user>.github.io`
- [ ] Spam check: verify honeypot works
- [ ] Full RLS audit in Supabase dashboard (confirm anon key cannot UPDATE/DELETE events)

---

## Current Status

**Slice 0 complete.** Walking skeleton scaffolded.
**Slice 1 complete.** Live site on GitHub Pages connected to Supabase. Schema applied, seed data loaded, Edge Functions deployed, pg_cron running, test event verified.

**Next action:** Slice 2 — polish the public event feed (filters, geolocation, calendar view, event detail modal).

---

## GitHub Secrets Required

| Secret | Description |
| --- | --- |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | Public anon key (safe to expose) |
| `UMAMI_SITE_ID` | Umami Cloud site ID (optional) |

## Edge Function Env Secrets (set in Supabase dashboard)

| Secret | Description |
| --- | --- |
| `RESEND_API_KEY` | Resend API key |
| `N8N_WEBHOOK_URL` | Full n8n webhook URL |
| `N8N_WEBHOOK_TOKEN` | n8n Header Auth token |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (admin only) |
| `SUPABASE_URL` | Same as above |
