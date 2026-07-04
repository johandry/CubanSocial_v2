# CubanSocial — Product Requirements Document (PRD)

**Version:** 1.2  
**Date:** 2026-07-04  
**Domain:** CubanSocial.com  
**Author:** AI Product Manager (GitHub Copilot)  
**Status:** MVP — Ready for Vibe Coding

---

## 1. Executive Summary & Goals

### The Problem

Cuban Salsa (Timba) dancers and Latin dance enthusiasts have no single, reliable place to discover local dance events. Information is scattered across WhatsApp groups, Instagram stories, and word-of-mouth. Events are missed, or found only after they've passed.

### The Solution

CubanSocial is a **free, web-based event board** dedicated to Latin and Caribbean dance events — with a focus on Cuban Salsa (Timba). It aggregates events from social media, WhatsApp group posts (via user submission), and direct organizer input. Admins review and approve events before they go live. Once approved, a formatted Instagram post draft is generated automatically for the admin to copy. The site is visually tropical, vibrant, and unmistakably Cuban.

### MVP Goals

| Goal | Metric |
| --- | --- |
| Events discoverable in one place | > 10 events listed within first month |
| Reduce missed events | Reminders sent 3 days before each event |
| Low/zero infrastructure cost | < $5/month total |
| Fast admin validation | < 2 minutes to review + approve an event |

---

## 2. User Personas & Roles

| Role | Description | Access Level |
| --- | --- | --- |
| **Visitor** | Anonymous dancer browsing events; no login required | Read-only |
| **Submitter** | Any dancer or event organizer who submits an event via form | Submit form (no account) |
| **Admin** | Trusted moderator who reviews, edits, approves, or rejects events | Full CRUD + publish tools |

> There is **no public user account system** in the MVP. Only admins have accounts.

---

## 3. User Flows

### 3.1 Visitor Flow (Event Discovery)

```text
Landing Page (event feed, city-filtered)
  │
  ├─► [First visit] Location prompt:
  │     ├─ "Allow" → Browser geolocation → auto-set city
  │     └─ "Deny" / Dismiss → Show city dropdown → user selects manually
  │                           (selection saved to localStorage)
  │
  ├─► Browse event cards (toggle: **Grid view** | **Calendar view** — see §5.7)
  │     ├─ Filter by: Dance style | Event type | Date range
  │     └─ Radius selector: [10 mi | 25 mi | 50 mi | 80 mi | Any] — events in cities within selected radius
  │
  └─► Click event card → Event detail modal/page
        ├─ Public event: shows full address + map link
        └─ Private event: shows city/neighborhood + "Contact Organizer" button; street address is always hidden
```

### 3.2 Event Submission Flow (Submitter)

```text
Click "Submit an Event" (CTA button)
  │
  ├─ Option A: Paste WhatsApp / social media text
  │     └─ App parses text → auto-fills form fields
  │
  └─ Option B: Fill form manually
        Fields: Name, Date/Time, Dance Style, Event Type,
                City, Address (or "Private"), Cost, Description,
                Organizer contact, External link
        │
        └─ Submit → "Thank you! Your event is under review." (toast)
              └─ Admin receives notification (email via Supabase)
```

### 3.3 Admin Validation Flow

```text
Admin receives email notification (new event pending)
  │
  └─ Opens Admin Dashboard (password-protected web page)
        │
        ├─ Pending events queue (card list)
        │     └─ Click event → Review form (pre-filled, fully editable)
        │           ├─ [Approve] → Event goes live on public feed
        │           │              → Instagram draft generated (caption + hashtags)
        │           │              → WhatsApp reminder scheduled
        │           └─ [Reject]  → Event removed from queue (optional note)
        │
        └─ Published events list (edit / unpublish / delete)
```

### 3.4 WhatsApp Reminder Flow

```text
Approved event with date set
  │
  └─ 3 days before event date:
        └─ pg_cron job (Supabase built-in) runs daily at 09:00 UTC
              └─ Queries approved events where:
                    start_at BETWEEN NOW()+3d AND NOW()+4d
                    AND reminder_sent_at IS NULL
                    └─ Calls `send-reminder` Edge Function (§6.8) via pg_net
                          └─ [MVP] Admin receives email with reminder draft text
                                   to manually post to WA groups
                          └─ Updates reminder_sent_at; logs to notification_log
                          └─ [Future] WhatsApp Business API auto-posts
```

### 3.5 Auto-Archive Flow

```text
Daily at 00:05 UTC:
  │
  └─ pg_cron job queries:
        events WHERE status = 'approved'
          AND COALESCE(end_at, start_at) < NOW() - INTERVAL '60 days'
        │
        └─ UPDATE status = 'archived' for all matching rows
              └─ Archived events are excluded from the public feed (RLS)
              └─ [Future] Admin dashboard toggle to browse archived events
```

> **Rule:** Any approved event whose start date (or end date, if set) is more than 60 days in the past is automatically archived. No manual admin action required.

---

## 4. Data Models

### 4.1 `dance_styles`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `name` | text | e.g. "Timba", "Salsa", "Bachata", "Merengue", "Cumbia" |
| `slug` | text unique | URL-safe, e.g. "timba" |
| `is_featured` | boolean | Show prominently in filters |

**Seed data:** Timba, Salsa (On1), Salsa (On2), Bachata, Merengue, Cumbia, Cha-cha-chá, Mambo, Kizomba, Reggaeton, Guaracha, Son Cubano

---

### 4.2 `cities`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `name` | text | e.g. "San Diego" |
| `state` | text | e.g. "CA" |
| `country` | text | default "US" |
| `lat` | numeric | Centroid latitude |
| `lon` | numeric | Centroid longitude |
| `is_active` | boolean | Hide cities with no events |

---

### 4.3 `events`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `name` | text NOT NULL | Event display name |
| `description` | text | Full description |
| `event_type` | enum | `studio_local`, `social_local`, `congress_national`, `congress_international` — see §8 for labels |
| `dance_style_ids` | uuid[] | FK → `dance_styles` (multiple allowed) |
| `city_id` | uuid | FK → `cities` |
| `address` | text | null when `is_private = true` |
| `is_private` | boolean | If true, street address is hidden on public feed; independent of `event_type` |
| `is_featured` | boolean | Auto-set true when Timba dance style is selected; admin-overridable |
| `organizer_contact` | text | The handle or number (e.g. `@dancewithana`, `+16195550123`); used to build the contact link |
| `organizer_contact_type` | enum | `instagram`, `whatsapp`, `email`, `other` — determines link behavior (`instagram.com/`, `wa.me/`, `mailto:`) |
| `organizer_name` | text | Display name shown to visitors; used to identify the organizer without exposing raw contact info |
| `media_url` | text | Pasted URL — direct image link or social media post (Instagram, Facebook, etc.) |
| `external_link` | text | URL to ticketing page or external event listing |
| `start_at` | timestamptz NOT NULL | |
| `end_at` | timestamptz | Optional |
| `cost_type` | enum | `free`, `paid`, `potluck`, `tips`, `sliding_scale` |
| `cost_amount` | numeric | null if free |
| `cost_notes` | text | e.g. "Ladies free before 10pm" |
| `status` | enum | `pending`, `approved`, `rejected`, `archived`, `cancelled` — `cancelled` used only on individual child instances of recurring events |
| `source` | enum | `whatsapp_paste`, `whatsapp_paste_ai_assisted`, `manual_form`, `admin_direct` |
| `raw_submission_text` | text | Original pasted text (for audit) |
| `instagram_draft` | text | Auto-generated caption |
| `reminder_sent_at` | timestamptz | Null until reminder dispatched |
| `recurrence_type` | enum | `none` (default), `weekly`, `biweekly`, `monthly` |
| `recurrence_end_at` | timestamptz | Optional series end date; null = auto-generate 12 weeks ahead |
| `parent_event_id` | uuid FK | Null on standalone and parent events; set on auto-generated child instances |
| `created_at` | timestamptz | auto |
| `approved_at` | timestamptz | |
| `approved_by` | uuid | FK → `admins.id` |

---

### 4.4 `admins`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | Maps to Supabase Auth user |
| `email` | text | Supabase Auth email |
| `display_name` | text | |
| `created_at` | timestamptz | |

> Admin accounts are created directly in Supabase Auth (no self-registration).

---

### 4.5 `notification_log`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `event_id` | uuid FK | |
| `type` | enum | `reminder_draft`, `instagram_draft`, `admin_email` |
| `sent_at` | timestamptz | |
| `content` | text | Message/caption that was generated |

---

## 5. Core UI/UX Requirements

### 5.1 Visual Tone

- **Palette:** Vibrant tropical — deep Caribbean blue (`#0066CC`), warm yellow (`#FFD700`), Cuban red (`#CC2200`), white, with green accent
- **Typography:** Bold display font (e.g. Google Fonts: *Bebas Neue* or *Righteous*) for headings; clean sans-serif (*Inter* or *Nunito*) for body
- **Imagery:** Subtle background patterns — tropical leaves, music notes, dancer silhouettes (CSS only, no heavy images in MVP)
- **Vibe:** Feels like a Cuban social club poster — warm, festive, welcoming

### 5.2 Page Structure (Single-Page App)

```text
┌─────────────────────────────────────────────┐
│  HEADER: Logo "CubanSocial" + City Selector │
│          + "Submit Event" CTA button        │
├─────────────────────────────────────────────┤
│  HERO: Tagline + Location detection prompt  │
├─────────────────────────────────────────────┤
│  FILTER BAR:                                │
│    Dance Style | Date Range | Event Type    │
│    [★] Featured only                        │
│    📍 Radius: [10mi | 25mi | 50mi | 80mi | Any] │
│  [☰ Grid] [📅 Calendar]  view toggle        │
├─────────────────────────────────────────────┤
│  EVENT FEED (cards grid, responsive)        │
│  ┌──────┐ ┌──────┐ ┌──────┐                 │
│  │ Card │ │ Card │ │ Card │                 │
│  └──────┘ └──────┘ └──────┘                 │
├─────────────────────────────────────────────┤
│  FOOTER: About | Submit | Instagram link    │
└─────────────────────────────────────────────┘
```

### 5.3 Event Card Components

Each card shows: media preview (thumbnail if `media_url` is a direct image; omitted if it is a social post URL), event name, date badge, city, dance styles (color-tagged chips), cost badge, and a "View Details" button.

- **Studio/Org event card** (`studio_local`): Full address shown. No lock icon.
- **Private social card** (`social_local`, `is_private = true`): Street address replaced with a lock icon + "Contact Organizer" link; city and neighborhood always visible.
- **Private social card** (`social_local`, `is_private = false`): Full address shown (e.g. informal social at a café or park).
- **Congress card** (`congress_national` / `congress_international`): "Congress" badge; address always shown; national/international scope label.
- **Featured event card**: Any event with `is_featured = true` shows a gold "⭐ Featured" badge. All events — featured or not — appear in the **same grid**. The "⭐ Featured only" filter toggle (default: **off**) narrows the visible events to featured only.

**Pagination:** The main feed loads the next **30 days** of approved upcoming events by default, sorted by `start_at` ascending. A "Load more" button fetches the following 30 days. Past events are hidden from the default feed (future: admin toggle to show archived/past events).

**Cost notes tooltip:** When `cost_notes` is set (e.g. "Ladies free before 10 PM"), a `(?)` icon appears inline next to the cost badge on both the event card and the detail modal. Clicking or hovering the icon reveals the full note in a small tooltip popup.

**Calendar view:** When the Calendar toggle is active, the event feed switches to a month grid layout (see §5.7 for full spec). All filters remain active.

### 5.4 Event Detail Modal

- Full description, organizer info, all dance styles, external event link
- City is always shown; for public events also shows full address + Google Maps link; for private events the address is hidden
- **Organizer contact:** organizer name is always shown. The contact method is displayed as a linked button: Instagram `@handle` opens `instagram.com/{handle}`; WhatsApp number opens `wa.me/{number}`; email opens a `mailto:` link. For private events, this linked contact button is the primary call to action ("Contact [Name] on Instagram / WhatsApp").
- **Cost notes:** if `cost_notes` is set, a `(?)` icon next to the cost shows the note on click/hover (tooltip).
- "Add to Calendar" button (.ics download, zero-dependency)
- Shareable URL (`/event/{id}`)

### 5.5 Submit Event Form

- Two-tab layout: **"Paste Text"** (textarea + "Parse" button + "Try AI Assist" fallback) | **"Fill Manually"**
- Parse button uses basic regex/NLP to extract date, location, and keywords from pasted text
- If regex fills fewer than 3 required fields, a **"Try AI Assist"** button appears — available to all submitters (see §6.4)
- **Media URL field:** Single text input labeled *"Event poster or post link (optional)"*. Accepts a direct image URL or a link to a social media post (Instagram, Facebook, etc.). Stored as `media_url`. No file upload.
- All fields labeled clearly; required fields marked
- Honeypot field for basic bot protection (no CAPTCHA for MVP)
- Confirmation toast on submit

### 5.6 Admin Dashboard (`/admin`)

- Protected by Supabase Auth (email + password)
- Pending queue count badge in header
- Two-column layout: Pending | Published
- Quick-action buttons: Approve ✓ | Reject ✗ | Edit ✎
- **Media URL field** in the review/edit form: editable text input for `media_url`; if the URL resolves to an image, a small inline preview is shown
- **Featured toggle:** Checkbox in the review/edit form for `is_featured`; auto-checked when the event includes Timba; admin can override in either direction
- Editing an already-approved/live event keeps `status = 'approved'` — changes go live immediately without re-review
- Instagram draft panel: auto-generated caption + hashtag block, "Copy to Clipboard" button
- WhatsApp reminder draft panel: formatted reminder text, "Copy to Clipboard" button

### 5.7 Calendar View

An alternative feed layout toggled via **Grid | Calendar** buttons above the event feed.

- **Month grid layout:** 7-column (Sun–Sat), rows for each week of the displayed month.
- Each day cell shows up to 3 coloured dot indicators — one per event starting that day; if more than 3, a `+N` label is shown.
- **Day click:** clicking a day with events opens a compact event list for that day (panel below the grid on mobile; popover on desktop). Clicking an event in the list opens the standard Event Detail modal.
- **Navigation:** Prev / Next month arrow buttons; "Today" button returns to current month.
- **Filters:** all active filters (city, dance style, event type, featured, radius) apply in both Grid and Calendar views.
- **Mobile:** calendar collapses to a scrollable 3-day weekly strip; swipe left/right to advance by one day.
- **Recurring events:** each generated child instance appears as its own dot on its respective day; cancelled instances are not shown.
- **Implementation:** pure vanilla JS + CSS grid; no third-party calendar library.

---

## 6. Technical Architecture

### 6.1 Tech Stack

| Layer | Choice | Cost |
| --- | --- | --- |
| **Frontend** | Vanilla HTML + CSS + JavaScript (no framework) | Free |
| **Hosting** | GitHub Pages | Free |
| **Database** | Supabase (PostgreSQL) | Free tier (500MB, 50k rows) |
| **Auth** | Supabase Auth (email/password for admins only) | Free tier |
| **Scheduled jobs** | Supabase `pg_cron` + Edge Functions (Deno) | Free tier (500k invocations/month) |
| **Email notifications** | Resend (via Supabase Edge Function) | Free tier (3,000 emails/month) |
| **AI Agent / Parser** | n8n Cloud | Free tier (2,500 executions/month) |
| **Analytics** | Umami Cloud | Free tier (10k pageviews/month) |
| **Maps** | Google Maps embed URL (no API key for embeds) | Free |
| **Geolocation** | Browser native `navigator.geolocation` API | Free |

### 6.2 Supabase Row-Level Security (RLS) Rules

- `events`: Public can `SELECT` where `status = 'approved'`
- `events`: Anyone can `INSERT` (submissions); no `UPDATE` or `DELETE`
- `events`: Admins can do full CRUD via service role key (admin dashboard only)
- `admins`: Admins can read own row only
- `cities`, `dance_styles`: Public `SELECT`, admin-only `INSERT/UPDATE`

### 6.3 Geolocation Logic

1. On page load, call `navigator.geolocation.getCurrentPosition()`
2. If granted → compute distance from user's `[lat, lon]` to each `cities` record using Haversine formula (client-side JS)
3. Default feed shows events in cities within **25 miles** of user coords (default radius)
4. **Radius dropdown** in the filter bar: **10 mi | 25 mi | 50 mi | 80 mi | Any distance** — selecting "Any" shows all cities regardless of distance; selection persisted in `localStorage` key `cubansocial_radius`
5. If geolocation is denied → fall back to city dropdown (populated from `cities` table); no radius filtering applied
6. City selection persisted in `localStorage` key `cubansocial_city`

### 6.4 WhatsApp Text Parser (Client-Side)

A lightweight JS function (`parseEventText(rawText)`) applies regex patterns to extract:

- **Date/Time:** Common patterns — "Saturday June 28", "6/28 at 8pm", "this Friday 9PM"
- **Location keywords:** Street addresses, city names from `cities` table
- **Cost:** "$", "free", "potluck", "tips"
- **Dance keywords:** Match against `dance_styles.name` list
- Returns a pre-filled form object; user reviews and corrects before submitting

#### Parser Fallback — n8n AI Agent

If the regex parser fills fewer than 3 required fields, the form shows a "Couldn't parse — try AI assist" notice and a **"Try AI Assist"** button. Clicking it sends the raw event text to an **n8n webhook** that runs an AI Agent workflow. The agent parses the text, returns structured field values, and if any required fields are still missing, sends back clarifying questions for the user to answer before the fields are filled.

**Platform:** [n8n Cloud](https://n8n.io) free tier — 5 active workflows, 2,500 executions/month; sufficient for low event-volume MVP.

**Webhook security — Supabase Edge Function proxy (chosen method):**

The n8n webhook URL and secret token are never exposed in the client JS bundle. Instead:

1. The browser calls `POST /functions/v1/parse-event` — a **Supabase Edge Function** (already publicly known; protected by Supabase's rate limiting).
2. The Edge Function holds the real n8n URL and an `X-Webhook-Token` secret as **environment secrets** (never in source code).
3. The Edge Function forwards the request to n8n with the token in the header.
4. The n8n webhook node is configured with **Header Auth** (n8n credential type), rejecting any call that lacks the matching token.

Result: the client never sees the n8n URL or secret; Supabase's built-in `max_request_rate` limits abuse from the client side.

**Workflow overview:**

```text
Webhook Trigger (POST /parse-event)
  │
  ├─► AI Agent node (GPT-4o-mini via OpenRouter free tier, or Gemini via free API key)
  │     System prompt: extract dance event fields; return JSON; list missing required fields
  │
  ├─► IF missing fields > 0
  │     └─► Respond with { status: "incomplete", fields: {...}, missing: [...], questions: [...] }
  │
  └─► IF all required fields present
        └─► Respond with { status: "complete", fields: {...} }
```

**n8n workflow inputs/outputs:**

- **Request body:** `{ "text": "<raw event text>", "clarifications": { "<field>": "<answer>", ... } }` — `clarifications` is omitted on the first call; the client populates it with user answers and re-calls on subsequent passes.
- **Response (complete):** `{ "status": "complete", "fields": { "name": "...", "date": "...", "startTime": "...", "endTime": "...", "city": "...", "address": "...", "danceStyles": [...], "cost": "...", "organizerContact": "...", "description": "...", "externalLink": "..." } }`
- **Response (incomplete):** `{ "status": "incomplete", "fields": { ... }, "missing": ["date", "city"], "questions": ["What date is this event?", "Which city?"] }`

**Client-side integration (`parseEventWithAgent(rawText, clarifications)`):**

1. POST to the Supabase Edge Function URL (`/functions/v1/parse-event`); no client-side secret required.
2. If `status === "complete"` → auto-fill all form fields with returned values; set `source = 'whatsapp_paste_ai_assisted'`.
3. If `status === "incomplete"` → display each item in `questions[]` as an inline labeled input below the paste textarea; user answers → re-call with `clarifications` map populated.
4. Maximum 2 clarification rounds before falling back to a fully manual form.
5. **Network error fallback:** If the request times out (> 10 s) or returns a non-2xx response, the button resets silently and a non-blocking inline notice appears: *“AI assist is temporarily unavailable. Please fill in the details manually.”* — the form remains fully functional.

**Cost:** Free — n8n Cloud free tier; Gemini API via OpenRouter free tier; Supabase Edge Function invocations within free tier.

### 6.5 Instagram Draft Generator

On admin approval, a JS function generates a caption that reads like a human wrote it — minimal emoji use, no decorative icons on every line.

```text
[Event Name] — [City]
[Day], [Month DD] at [Start Time][, until End Time if available]

[Description — first 150 characters, trimmed at word boundary]

[Dance Styles] | [Cost info]
[Address — only if public; omit entirely if private]

More events: CubanSocial.com

#CubanSocial #[DanceStyle] #[City]Dance #LatinDance #CubanSalsa #Timba
```

This is displayed in a copyable textarea — admin pastes it into Instagram manually. Hashtags are auto-generated from the event's dance styles and city; the admin can edit them before posting.

### 6.6 Admin Email Notification Trigger

When a new event is submitted (INSERT on `events` with `status = 'pending'`), all admins receive an email within seconds.

**Implementation:**

1. **Supabase Database Webhook** on `INSERT` to `events` — fires immediately and invokes the `notify-admin` Supabase Edge Function.
2. `notify-admin` queries the `admins` table for all admin emails and sends via **Resend** (free tier: 3,000 emails/month, 100/day — sufficient for MVP volume).
3. The Resend API key is stored as a Supabase Edge Function environment secret (never in source code or client).

**Email spec:**

- **Subject:** `[CubanSocial] New event pending: {event_name}` — plain text subject ensures the event name appears immediately in the iPhone lock screen notification preview
- **Body:** Event name, submitted date, city, dance styles, and a direct link to the admin dashboard (`https://cubansocial.com/admin`)
- **From:** `noreply@cubansocial.com` (Resend custom domain)

### 6.7 Auto-Archive Edge Function

Approved events more than 60 days past their start date are automatically archived, keeping the public feed clean without admin intervention.

**Implementation:** A `pg_cron` job (built into Supabase — no external scheduler) runs daily at `00:05 UTC`:

```sql
UPDATE events
SET status = 'archived'
WHERE status = 'approved'
  AND COALESCE(end_at, start_at) < NOW() - INTERVAL '60 days';
```

- No Edge Function needed — the SQL runs directly via `pg_cron` in the database.
- Archived events are automatically excluded from the public feed via the existing RLS rule (`status = 'approved'`).
- **Future:** Admin dashboard toggle to browse archived events (read-only filtered view).

### 6.8 WhatsApp Reminder Edge Function (`send-reminder`)

Sends a reminder draft email to all admins 3 days before each approved event so they can manually post to WhatsApp groups.

**Trigger:** A `pg_cron` job runs daily at **09:00 UTC** and calls the `send-reminder` Edge Function via the `pg_net` extension (must be enabled in the Supabase dashboard under Extensions):

```sql
-- pg_cron job: daily at 09:00 UTC
SELECT net.http_post(
  url     := current_setting('app.supabase_url') || '/functions/v1/send-reminder',
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
    'Content-Type',  'application/json'
  ),
  body    := '{}'::jsonb
);
```

**`send-reminder` Edge Function logic (Deno):**

1. Queries `events` using service role key:

   ```sql
   SELECT * FROM events
   WHERE status = 'approved'
     AND reminder_sent_at IS NULL
     AND start_at >= NOW() + INTERVAL '3 days'
     AND start_at <  NOW() + INTERVAL '4 days';
   ```

2. For each matching event: builds a WhatsApp-formatted reminder text block (same format as the admin dashboard draft panel).
3. Emails all admins via **Resend** (subject: `[CubanSocial] Reminder draft: {event_name} — {date}`).
4. Sets `reminder_sent_at = NOW()` on the event row (prevents duplicate reminders).
5. Inserts a row into `notification_log` (`type = 'reminder_draft'`).

**Environment secrets required** (shared with `notify-admin`): `RESEND_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

---

### 6.9 Recurring Events

Weekly classes and regular socials repeat on a fixed schedule. Individual occurrences can be cancelled (e.g. for holidays) without disrupting the rest of the series.

**Data model additions** (fields on `events` — see §4.3):

- `recurrence_type`: `none` (default) | `weekly` | `biweekly` | `monthly`
- `recurrence_end_at`: optional series end date; null = auto-generate 12 weeks ahead on a rolling basis
- `parent_event_id`: null on standalone events and parent events; set on auto-generated child instances
- `status = 'cancelled'`: used only on child instances to hide a single occurrence from the public feed

**Parent vs. child rows:**

- The **parent row** IS the first real occurrence of the series. It has `parent_event_id = null`, `recurrence_type != none`, and `status = 'approved'`. It appears in the public feed like any other event.
- **Child rows** are auto-generated copies of the parent with successive `start_at` / `end_at` dates. They have `parent_event_id` set and start with `status = 'approved'`. Only non-date fields are copied (name, description, address, dance styles, cost, organizer).

**Admin approval flow for recurring events:**

1. Submit form includes `recurrence_type` selector and optional `recurrence_end_at` date field.
2. Admin approves the parent event. The admin dashboard calls the `generate-recurrences` Edge Function, which creates child rows for the next 12 weeks (or until `recurrence_end_at`).
3. In the Published list, child instances are grouped under their parent row (collapsed by default, showing an "X upcoming" label). Expanding the group shows each instance date with cancel controls.

**Admin actions on a recurring series:**

- **Cancel one instance:** sets `status = 'cancelled'` on that child → immediately hidden from the public feed; other instances unaffected.
- **Cancel all future instances:** sets `status = 'cancelled'` on all children where `start_at > NOW()`.
- **Edit one occurrence:** edits only that child row; does not affect siblings or parent.
- **Edit entire series:** editing the parent row propagates non-date field changes to all future `approved` children (`start_at`/`end_at` are never overwritten on children).

**Rolling generation (`generate-recurrences` Edge Function):**

- Called immediately on parent approval (from admin dashboard JS) and by a weekly pg_cron job (Sundays 08:00 UTC via `pg_net`).
- Queries parent events with `recurrence_type != 'none'`; counts upcoming `approved` + `cancelled` children; generates new child rows to keep 12 weeks of instances populated.
- New child rows start with `status = 'approved'` (inheriting the parent's approved state).

**Environment secrets required:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

---

## 7. MVP vs. Skip List

### ✅ Build in MVP

- Public event feed with city filtering and **radius dropdown** (10 mi / 25 mi / 50 mi / 80 mi / Any)
- **Grid view** and **Calendar view** toggle (month grid with event dots and day-click list — see §5.7)
- Featured event `⭐` badge on cards; "Featured only" filter toggle (default: off); all events in same grid
- Submit event form (paste-to-parse + manual fill) with **recurring event** option (§6.9)
- Recurring events: weekly / biweekly / monthly series; per-instance cancel; rolling 12-week generation (§6.9)
- **Cost notes `(?)` tooltip** on event cards and detail modal
- Organizer contact linked button (Instagram / WhatsApp / email) in event detail modal (§5.4)
- n8n AI Agent fallback parser (via Supabase Edge Function proxy, §6.4)
- Admin email notification on new submission (Resend via Supabase Database Webhook, §6.6)
- Admin dashboard with approve/reject/edit queue; recurring series grouping with per-instance cancel
- Editing approved events stays live immediately (no re-review)
- Instagram caption draft generator
- WhatsApp reminder draft email to admins (`send-reminder` Edge Function, pg_cron, §6.8)
- Auto-archive events 60 days past start date (pg_cron SQL, §6.7)
- Recurring event instance auto-generation (`generate-recurrences` Edge Function, §6.9)
- Supabase Auth for admin login
- Event detail modal with "Add to Calendar" (.ics) + shareable URL
- OG meta tags per event (`og:title`, `og:description`, `og:image`) for WhatsApp/Instagram link previews
- Page view + interaction analytics (Umami Cloud)
- RLS-protected Supabase backend
- Responsive design (mobile-first)
- Basic bot protection on submit form (honeypot)

### ❌ Skip for MVP (Future Versions)

- Browse past / archived events (public feed toggle)
- WhatsApp Business API (auto-posting reminders)
- WhatsApp bot for event queries ("send EVENTS to get list")
- Facebook publishing
- Mobile apps (iOS / Android)
- User accounts / dancer profiles
- Direct email or SMS notifications to end users
- Integrated map/directions (replace with plain Google Maps link)
- Monetization (ads, featured listings, tickets)
- Event RSVP / attendance tracking
- Automated social media scraping
- Media moderation API
- Spanish localization
- **AI social media manager via Hermes:** Configure the Hermes AI agent to handle Instagram, Facebook, and WhatsApp posting autonomously after event approval. No new application code — implementation is a Hermes config update pointing to the CubanSocial events feed as a data source and defining post actions and schedule. Hermes manages caption drafting, publishing, and retry logic through its own configuration.

---

## 8. Content & Seed Data

### Dance Styles (seed on first deploy)

Timba, Salsa (On1), Salsa (On2), Bachata, Merengue, Cumbia, Cha-cha-chá, Mambo, Kizomba, Reggaeton, Guaracha, Son Cubano

### Initial City Coverage (California focus for launch)

San Diego, Los Angeles, San Francisco, San Jose, Sacramento, Orange County, Riverside, Palm Springs

### Event Types

| Type | Display Label | Organized By | `is_private` default | Address Shown? |
| --- | --- | --- | --- | --- |
| `studio_local` | Studio / Org Event | Dance studio, school, or public organization | `false` | ✅ Yes (always) |
| `social_local` | Private Social | Group of people; venue may be a house or private space | `true` | Depends on `is_private` flag |
| `congress_national` | National Congress | Professional promoters | `false` | ✅ Yes (always) |
| `congress_international` | International Congress | Professional promoters | `false` | ✅ Yes (always) |

> **`is_private` is independent of `event_type`.** A `social_local` can have `is_private = false` (e.g. informal social at a park or café), and in rare cases a `studio_local` could be `is_private = true`. Congress events are always `is_private = false` and the address is always displayed.

---

## 9. Non-Functional Requirements

| Requirement | Target |
| --- | --- |
| Page load time | < 2 seconds on mobile (3G) |
| Accessibility | WCAG 2.1 AA color contrast; keyboard-navigable; ARIA landmarks on all sections; focus trap in modals |
| Monthly infra cost | < $5 USD |
| No backend language needed | All logic in JS + Supabase SQL/Edge Functions |
| Admin dashboard security | Supabase Auth JWT; no service key exposed to client; n8n URL + token stored only in Edge Function env secrets |
| Spam protection | Honeypot field + Supabase rate limiting on inserts |
| Social sharing | OG meta tags (`og:title`, `og:description`, `og:image`) set dynamically per event for WhatsApp/Instagram link previews |
| Analytics | Umami Cloud script tag; tracks page views and key interactions (filter use, AI Assist clicks, event card clicks); no PII collected |

---

## 10. Open Questions / Decisions Deferred

1. **Domain DNS:** CubanSocial.com needs a CNAME pointing to GitHub Pages — configure after initial deploy.
2. **Media URL moderation:** Admins manually review `media_url` links. Social media post URLs (Instagram, Facebook) will not render as image previews — admins should replace with a direct image URL when possible. Future: automated media moderation API.
3. **Multi-language:** All copy in English for MVP; Spanish localization is a strong V2 candidate given the audience.
4. **WhatsApp group list:** Which specific groups receive reminders will be curated by admins (not automated discovery).
5. **Congress featured section:** National/international congresses may need a dedicated featured section on the homepage in V2, separate from the Timba Featured Events row.
6. **Umami custom events:** Define which interactions to track beyond page views (e.g. filter usage, "Try AI Assist" clicks, card clicks) — finalize during implementation.
7. **n8n LLM key management:** Gemini or OpenRouter API key stored in n8n Cloud credentials. If the free tier is exhausted, the AI Assist silently degrades to the manual fallback (per §6.4 error handling) — no user-facing error required.
8. **`is_featured` auto-rule:** Currently auto-set when Timba is a selected dance style. If an event has both Timba and other styles, it is still featured. Admin can uncheck manually if desired.

---

*Document end. Ready for implementation.*
