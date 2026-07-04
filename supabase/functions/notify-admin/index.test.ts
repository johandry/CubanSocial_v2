/**
 * Tests for the notify-admin Edge Function.
 *
 * Run with:
 *   deno test --allow-env supabase/functions/notify-admin/index.test.ts
 *
 * The Supabase client and Resend are both mocked via globalThis.fetch —
 * no real network calls are made.
 */

import {
  assertEquals,
  assertStringIncludes,
} from 'https://deno.land/std@0.168.0/testing/asserts.ts';

import { handler } from './index.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Set all required env vars before each test. */
function setEnv(overrides: Record<string, string> = {}) {
  Deno.env.set('SUPABASE_URL',                'https://test-project.supabase.co');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY',   'test-service-role-key');
  Deno.env.set('RESEND_API_KEY',              're_test_abc123');
  for (const [k, v] of Object.entries(overrides)) Deno.env.set(k, v);
}

/**
 * Build a simulated Supabase Database Webhook POST request.
 * The payload follows the format: { type, table, record, old_record }.
 */
function webhookRequest(record: Record<string, unknown>): Request {
  return new Request('https://fn.supabase.co/functions/v1/notify-admin', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ type: 'INSERT', table: 'events', schema: 'public', record }),
  });
}

/** Minimal pending event record. */
function pendingEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id:         'evt-test-123',
    name:       'Timba Night',
    status:     'pending',
    created_at: '2026-07-10T20:00:00.000Z',
    ...overrides,
  };
}

/**
 * Creates a mock fetch function that:
 *   - Returns `admins` array for any Supabase REST /admins request
 *   - Returns success for Resend requests
 *   - Records all calls for assertions
 */
function createMockFetch(admins: { email: string }[] = []) {
  const calls: CapturedCall[] = [];

  const mock = async (
    input: Request | URL | string,
    init?: RequestInit,
  ): Promise<Response> => {
    const req  = input instanceof Request ? input : null;
    const url  = req?.url ?? (input instanceof URL ? input.href : String(input));
    const mth  = req?.method ?? init?.method ?? 'GET';
    const hdrs = Object.fromEntries(
      new Headers(req ? undefined : (init?.headers ?? {})).entries(),
    );
    const body = init?.body
      ? String(init.body)
      : (req ? await req.clone().text() : '');

    calls.push({ url, method: mth, headers: hdrs, body });

    // Supabase REST API — return the mock admin list
    if (url.includes('/rest/v1/admins')) {
      return new Response(JSON.stringify(admins), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Resend email API — return success
    if (url === 'https://api.resend.com/emails') {
      return new Response(JSON.stringify({ id: 'resend-msg-ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Any other Supabase internal call (auth schema checks, etc.)
    return new Response('{}', { status: 200 });
  };

  return { mock: mock as typeof globalThis.fetch, calls };
}

/** Run a test with a temporary fetch mock, restoring the original afterwards. */
async function withMockFetch<T>(
  mock: typeof globalThis.fetch,
  fn: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

// ---------------------------------------------------------------------------
// Tests — event status filtering
// ---------------------------------------------------------------------------

Deno.test('skips approved events: returns "not pending" without sending email', async () => {
  setEnv();
  const { mock, calls } = createMockFetch([{ email: 'admin@test.com' }]);

  const res = await withMockFetch(mock, () =>
    handler(webhookRequest(pendingEvent({ status: 'approved' }))),
  );

  assertEquals(res.status, 200);
  assertEquals(await res.text(), 'not pending');
  assertEquals(calls.filter(c => c.url.includes('resend.com')).length, 0,
    'No email should be sent for non-pending events');
});

Deno.test('skips rejected events: returns "not pending"', async () => {
  setEnv();
  const { mock } = createMockFetch([]);

  const res = await withMockFetch(mock, () =>
    handler(webhookRequest(pendingEvent({ status: 'rejected' }))),
  );

  assertEquals(res.status, 200);
  assertEquals(await res.text(), 'not pending');
});

Deno.test('skips archived events: returns "not pending"', async () => {
  setEnv();
  const { mock } = createMockFetch([]);

  const res = await withMockFetch(mock, () =>
    handler(webhookRequest(pendingEvent({ status: 'archived' }))),
  );

  assertEquals(res.status, 200);
  assertEquals(await res.text(), 'not pending');
});

Deno.test('skips cancelled events: returns "not pending"', async () => {
  setEnv();
  const { mock } = createMockFetch([]);

  const res = await withMockFetch(mock, () =>
    handler(webhookRequest(pendingEvent({ status: 'cancelled' }))),
  );

  assertEquals(res.status, 200);
  assertEquals(await res.text(), 'not pending');
});

Deno.test('handles missing record field: returns "not pending"', async () => {
  setEnv();
  const { mock } = createMockFetch([]);

  const req = new Request('https://fn.supabase.co/functions/v1/notify-admin', {
    method: 'POST',
    body:   JSON.stringify({ type: 'INSERT', table: 'events' }), // no record
  });

  const res = await withMockFetch(mock, () => handler(req));

  assertEquals(res.status, 200);
  assertEquals(await res.text(), 'not pending');
});

// ---------------------------------------------------------------------------
// Tests — admin query
// ---------------------------------------------------------------------------

Deno.test('returns "no admins" when admins table is empty — no email sent', async () => {
  setEnv();
  const { mock, calls } = createMockFetch([]); // empty admins

  const res = await withMockFetch(mock, () =>
    handler(webhookRequest(pendingEvent())),
  );

  assertEquals(res.status, 200);
  assertEquals(await res.text(), 'no admins');
  assertEquals(calls.filter(c => c.url.includes('resend.com')).length, 0);
});

Deno.test('uses service role key — not anon key — when querying admins', async () => {
  setEnv({ SUPABASE_SERVICE_ROLE_KEY: 'secret-service-key-xyz' });
  const { mock, calls } = createMockFetch([{ email: 'admin@cubansocial.com' }]);

  await withMockFetch(mock, () => handler(webhookRequest(pendingEvent())));

  const supabaseCall = calls.find(c => c.url.includes('/rest/v1/admins'));
  // supabase-js sends the key in the Authorization header
  assertStringIncludes(
    supabaseCall?.headers['authorization'] ?? '',
    'secret-service-key-xyz',
    'Service role key must be used for the admin query',
  );
});

// ---------------------------------------------------------------------------
// Tests — email delivery
// ---------------------------------------------------------------------------

Deno.test('sends exactly one email per admin', async () => {
  setEnv();
  const admins = [
    { email: 'admin1@cubansocial.com' },
    { email: 'admin2@cubansocial.com' },
    { email: 'admin3@cubansocial.com' },
  ];
  const { mock, calls } = createMockFetch(admins);

  const res = await withMockFetch(mock, () =>
    handler(webhookRequest(pendingEvent())),
  );

  assertEquals(res.status, 200);
  assertEquals(await res.text(), 'ok');
  assertEquals(
    calls.filter(c => c.url === 'https://api.resend.com/emails').length,
    3,
    'One Resend call per admin',
  );
});

Deno.test('email subject includes the event name', async () => {
  setEnv();
  const { mock, calls } = createMockFetch([{ email: 'admin@cubansocial.com' }]);

  await withMockFetch(mock, () =>
    handler(webhookRequest(pendingEvent({ name: 'Friday Salsa Congress 2026' }))),
  );

  const resendCall = calls.find(c => c.url === 'https://api.resend.com/emails')!;
  const payload    = JSON.parse(resendCall.body);
  assertStringIncludes(payload.subject, 'Friday Salsa Congress 2026');
  assertStringIncludes(payload.subject, '[CubanSocial]');
});

Deno.test('email subject follows the "[CubanSocial] New event pending: {name}" format', async () => {
  setEnv();
  const { mock, calls } = createMockFetch([{ email: 'admin@cubansocial.com' }]);

  await withMockFetch(mock, () =>
    handler(webhookRequest(pendingEvent({ name: 'Bachata Night' }))),
  );

  const payload = JSON.parse(calls.find(c => c.url.includes('resend'))!.body);
  assertEquals(payload.subject, '[CubanSocial] New event pending: Bachata Night');
});

Deno.test('email is sent from noreply@cubansocial.com', async () => {
  setEnv();
  const { mock, calls } = createMockFetch([{ email: 'admin@cubansocial.com' }]);

  await withMockFetch(mock, () => handler(webhookRequest(pendingEvent())));

  const payload = JSON.parse(calls.find(c => c.url.includes('resend'))!.body);
  assertEquals(payload.from, 'noreply@cubansocial.com');
});

Deno.test('Authorization header uses the RESEND_API_KEY', async () => {
  setEnv({ RESEND_API_KEY: 're_unique_key_789' });
  const { mock, calls } = createMockFetch([{ email: 'admin@cubansocial.com' }]);

  await withMockFetch(mock, () => handler(webhookRequest(pendingEvent())));

  const resendCall = calls.find(c => c.url === 'https://api.resend.com/emails')!;
  // Headers are normalised to lowercase by the Headers constructor in createMockFetch
  assertEquals(resendCall.headers['authorization'], 'Bearer re_unique_key_789',
    'RESEND_API_KEY must appear in the Authorization header');
});

Deno.test('email body contains a link to the admin dashboard', async () => {
  setEnv();
  const { mock, calls } = createMockFetch([{ email: 'admin@cubansocial.com' }]);

  await withMockFetch(mock, () => handler(webhookRequest(pendingEvent())));

  const payload = JSON.parse(calls.find(c => c.url.includes('resend'))!.body);
  assertStringIncludes(payload.html, 'cubansocial.com/admin');
});

// ---------------------------------------------------------------------------
// Tests — error handling
// ---------------------------------------------------------------------------

Deno.test('handles malformed JSON body: returns 500', async () => {
  setEnv();
  const { mock } = createMockFetch([]);

  const req = new Request('https://fn.supabase.co/functions/v1/notify-admin', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    '{ not valid json <<<',
  });

  const res = await withMockFetch(mock, () => handler(req));
  assertEquals(res.status, 500);
});

Deno.test('handles empty body: returns 500', async () => {
  setEnv();
  const { mock } = createMockFetch([]);

  const req = new Request('https://fn.supabase.co/functions/v1/notify-admin', {
    method: 'POST',
    body:   '',
  });

  const res = await withMockFetch(mock, () => handler(req));
  assertEquals(res.status, 500);
});

Deno.test('continues processing and returns "ok" even if one Resend call fails', async () => {
  setEnv();
  const admins = [
    { email: 'admin1@cubansocial.com' },
    { email: 'admin2@cubansocial.com' },
  ];
  let resendCallCount = 0;

  const flakyFetch = async (
    input: Request | URL | string,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url
              : input instanceof URL     ? input.href
              : String(input);

    if (url.includes('/rest/v1/admins')) {
      return new Response(JSON.stringify(admins), { status: 200 });
    }
    if (url === 'https://api.resend.com/emails') {
      resendCallCount++;
      // First admin email deliberately fails
      if (resendCallCount === 1) {
        return new Response('Service Unavailable', { status: 503 });
      }
      return new Response(JSON.stringify({ id: 'msg-ok' }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };

  const res = await withMockFetch(flakyFetch as typeof globalThis.fetch, () =>
    handler(webhookRequest(pendingEvent())),
  );

  // The function should still return "ok" and attempt both emails
  assertEquals(res.status, 200);
  assertEquals(await res.text(), 'ok');
  assertEquals(resendCallCount, 2, 'Both admin emails should be attempted');
});
