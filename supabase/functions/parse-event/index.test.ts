/**
 * Tests for the parse-event Edge Function.
 *
 * Run with:
 *   deno test --allow-env supabase/functions/parse-event/index.test.ts
 *
 * n8n is mocked via globalThis.fetch — no real network calls are made.
 *
 * Each test uses a distinct x-forwarded-for IP so the in-memory rate limiter
 * does not carry state between test cases.
 */

import {
  assertEquals,
  assertExists,
} from 'https://deno.land/std@0.168.0/testing/asserts.ts';

import { handler } from './index.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Counter used to generate unique IP addresses per test. */
let ipCounter = 1;

/** Returns a unique string used as a rate-limiter key (Map key, not a real IP). */
function uniqueIp(): string {
  return `test-ip-${ipCounter++}`;
}

/** Set all required env vars before each test. */
function setEnv(overrides: Record<string, string> = {}) {
  Deno.env.set('N8N_WEBHOOK_URL',   'https://n8n.example.com/webhook/parse-event');
  Deno.env.set('N8N_WEBHOOK_TOKEN', 'test-n8n-secret-token');
  for (const [k, v] of Object.entries(overrides)) Deno.env.set(k, v);
}

/** Build a POST request with a text payload. */
function parseRequest(
  text: string,
  opts: {
    origin?: string;
    ip?: string;
    clarifications?: Record<string, string>;
  } = {},
): Request {
  const {
    origin = 'https://johandry.github.io/CubanSocialV2',
    ip     = uniqueIp(),
  } = opts;

  return new Request('https://fn.supabase.co/functions/v1/parse-event', {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      'Origin':          origin,
      'X-Forwarded-For': ip,
    },
    body: JSON.stringify({
      text,
      ...(opts.clarifications ? { clarifications: opts.clarifications } : {}),
    }),
  });
}

/** Build an OPTIONS preflight request. */
function optionsRequest(origin: string, ip: string = uniqueIp()): Request {
  return new Request('https://fn.supabase.co/functions/v1/parse-event', {
    method:  'OPTIONS',
    headers: { Origin: origin, 'X-Forwarded-For': ip },
  });
}

/** A successful n8n complete-parse response. */
const N8N_COMPLETE_RESPONSE = {
  status: 'complete',
  fields: {
    name:       'Timba Night',
    date:       '2026-07-12',
    startTime:  '21:00',
    city:       'San Diego',
    danceStyles: ['timba'],
  },
};

/** A successful n8n incomplete-parse response (needs clarification). */
const N8N_INCOMPLETE_RESPONSE = {
  status:    'incomplete',
  fields:    { name: 'Timba Night' },
  missing:   ['date', 'city'],
  questions: ['What date is this event?', 'Which city?'],
};

/**
 * Wraps a test with a temporary fetch mock that returns the given n8n response.
 * Captures the call for assertion.
 */
async function withN8nMock<T>(
  n8nResponse: unknown,
  statusCode: number,
  fn: () => Promise<T>,
): Promise<{ result: T; n8nCall: { url: string; headers: Record<string, string>; body: string } | null }> {
  let n8nCall: { url: string; headers: Record<string, string>; body: string } | null = null;

  const original = globalThis.fetch;
  globalThis.fetch = (async (
    input: Request | URL | string,
    init?: RequestInit,
  ): Promise<Response> => {
    const url  = input instanceof Request ? input.url
               : input instanceof URL     ? input.href
               : String(input);
    const hdrs = Object.fromEntries(new Headers(init?.headers ?? {}).entries());
    const body = String(init?.body ?? '');
    n8nCall = { url, headers: hdrs, body };
    return new Response(JSON.stringify(n8nResponse), {
      status:  statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await fn();
    return { result, n8nCall };
  } finally {
    globalThis.fetch = original;
  }
}

/** Mock fetch that throws a network error (simulates n8n being unreachable). */
async function withNetworkErrorMock<T>(fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error('Network error'))) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

// ---------------------------------------------------------------------------
// Tests — HTTP method & CORS handling
// ---------------------------------------------------------------------------

Deno.test('OPTIONS preflight from cubansocial.com returns 204 with CORS headers', async () => {
  setEnv();
  const req = optionsRequest('https://cubansocial.com');
  const res = await handler(req);

  assertEquals(res.status, 204);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://cubansocial.com');
  assertExists(res.headers.get('Access-Control-Allow-Methods'));
});

Deno.test('OPTIONS preflight from GitHub Pages origin returns 204 with CORS headers', async () => {
  setEnv();
  const req = optionsRequest('https://johandry.github.io');
  const res = await handler(req);

  assertEquals(res.status, 204);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://johandry.github.io');
});

Deno.test('OPTIONS preflight from unknown origin: returns 204 but NO CORS headers', async () => {
  setEnv();
  const req = optionsRequest('https://evil-site.example.com');
  const res = await handler(req);

  assertEquals(res.status, 204);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), null,
    'CORS headers must not be set for disallowed origins');
});

Deno.test('GET request returns 405 Method Not Allowed', async () => {
  setEnv();
  const req = new Request('https://fn.supabase.co/functions/v1/parse-event', {
    method:  'GET',
    headers: { 'X-Forwarded-For': uniqueIp() },
  });

  const res = await handler(req);
  assertEquals(res.status, 405);
});

Deno.test('PUT request returns 405 Method Not Allowed', async () => {
  setEnv();
  const req = new Request('https://fn.supabase.co/functions/v1/parse-event', {
    method:  'PUT',
    headers: { 'X-Forwarded-For': uniqueIp() },
  });

  const res = await handler(req);
  assertEquals(res.status, 405);
});

Deno.test('POST from disallowed origin: processes request but omits CORS headers', async () => {
  setEnv();
  const { result } = await withN8nMock(N8N_COMPLETE_RESPONSE, 200, () =>
    handler(new Request('https://fn.supabase.co/functions/v1/parse-event', {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'Origin':          'https://unknown.example.com',
        'X-Forwarded-For': uniqueIp(),
      },
      body: JSON.stringify({ text: 'Timba Night this Saturday 8pm San Diego free' }),
    })),
  );

  // Request should still be processed (no hard-block on unknown origin)
  assertEquals(result.headers.get('Access-Control-Allow-Origin'), null);
});

// ---------------------------------------------------------------------------
// Tests — input validation
// ---------------------------------------------------------------------------

Deno.test('malformed JSON body returns 400 with error code invalid_json', async () => {
  setEnv();
  const req = new Request('https://fn.supabase.co/functions/v1/parse-event', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': uniqueIp() },
    body:    '{ not: valid: json }',
  });

  const res  = await handler(req);
  const body = await res.json();
  assertEquals(res.status, 400);
  assertEquals(body.error, 'invalid_json');
});

Deno.test('missing text field returns 400 with error code text_required', async () => {
  setEnv();
  const req = new Request('https://fn.supabase.co/functions/v1/parse-event', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': uniqueIp() },
    body:    JSON.stringify({ clarifications: {} }),  // no text field
  });

  const res  = await handler(req);
  const body = await res.json();
  assertEquals(res.status, 400);
  assertEquals(body.error, 'text_required');
});

Deno.test('text shorter than 5 characters returns 400 (boundary: exactly 4 chars)', async () => {
  setEnv();
  const res  = await handler(parseRequest('abcd'));  // 4 chars — below limit
  const body = await res.json();
  assertEquals(res.status, 400);
  assertEquals(body.error, 'text_required');
});

Deno.test('text of exactly 5 characters is accepted (boundary: exactly 5 chars)', async () => {
  setEnv();
  const { result } = await withN8nMock(N8N_INCOMPLETE_RESPONSE, 200, () =>
    handler(parseRequest('abcde')),  // 5 chars — at the limit
  );
  // Should reach n8n (not rejected by validation)
  assertEquals(result.status, 200);
});

Deno.test('whitespace-only text (5+ spaces) returns 400 — trim check', async () => {
  setEnv();
  const res  = await handler(parseRequest('      '));  // spaces only
  const body = await res.json();
  assertEquals(res.status, 400);
  assertEquals(body.error, 'text_required');
});

// ---------------------------------------------------------------------------
// Tests — n8n forwarding
// ---------------------------------------------------------------------------

Deno.test('forwards valid request to n8n and returns its response', async () => {
  setEnv();
  const { result, n8nCall } = await withN8nMock(N8N_COMPLETE_RESPONSE, 200, () =>
    handler(parseRequest('Timba Night this Saturday 8pm San Diego')),
  );

  assertEquals(result.status, 200);
  const body = await result.json();
  assertEquals(body.status, 'complete');
  assertExists(n8nCall, 'n8n should have been called');
});

Deno.test('forwards request to the configured N8N_WEBHOOK_URL', async () => {
  setEnv({ N8N_WEBHOOK_URL: 'https://my-n8n.example.com/webhook/abc-123' });
  const { n8nCall } = await withN8nMock(N8N_COMPLETE_RESPONSE, 200, () =>
    handler(parseRequest('Timba Night Saturday 8pm San Diego free event')),
  );

  assertEquals(n8nCall?.url, 'https://my-n8n.example.com/webhook/abc-123');
});

Deno.test('sends X-Webhook-Token header with the configured secret', async () => {
  setEnv({ N8N_WEBHOOK_TOKEN: 'super-secret-n8n-token-xyz' });
  const { n8nCall } = await withN8nMock(N8N_COMPLETE_RESPONSE, 200, () =>
    handler(parseRequest('Salsa congress next weekend Los Angeles paid')),
  );

  assertEquals(
    n8nCall?.headers['x-webhook-token'],
    'super-secret-n8n-token-xyz',
    'The n8n token must be in the X-Webhook-Token header',
  );
});

Deno.test('n8n token is NOT present in the response body (never leaked to client)', async () => {
  setEnv({ N8N_WEBHOOK_TOKEN: 'do-not-leak-this-token' });
  const { result } = await withN8nMock(N8N_COMPLETE_RESPONSE, 200, () =>
    handler(parseRequest('Timba Night Saturday 8pm San Diego')),
  );

  const responseText = await result.text();
  assertEquals(
    responseText.includes('do-not-leak-this-token'),
    false,
    'The n8n token must never appear in the response',
  );
});

Deno.test('forwards text and clarifications to n8n request body', async () => {
  setEnv();
  const clarifications = { date: '2026-07-12', city: 'San Diego' };
  const { n8nCall } = await withN8nMock(N8N_COMPLETE_RESPONSE, 200, () =>
    handler(parseRequest('Timba Night 8pm free', { clarifications })),
  );

  const forwarded = JSON.parse(n8nCall!.body);
  assertEquals(forwarded.text,             'Timba Night 8pm free');
  assertEquals(forwarded.clarifications,   clarifications);
});

Deno.test('sends empty clarifications object when none provided', async () => {
  setEnv();
  const { n8nCall } = await withN8nMock(N8N_COMPLETE_RESPONSE, 200, () =>
    handler(parseRequest('Timba Night Saturday 8pm San Diego free')),
  );

  const forwarded = JSON.parse(n8nCall!.body);
  assertEquals(typeof forwarded.clarifications, 'object');
  assertEquals(Object.keys(forwarded.clarifications).length, 0);
});

Deno.test('propagates n8n status code to client (non-2xx)', async () => {
  setEnv();
  const { result } = await withN8nMock({ error: 'workflow_error' }, 422, () =>
    handler(parseRequest('Timba Night Saturday San Diego 8pm')),
  );

  assertEquals(result.status, 422);
});

Deno.test('returns CORS headers from allowed origin on successful n8n response', async () => {
  setEnv();
  const { result } = await withN8nMock(N8N_COMPLETE_RESPONSE, 200, () =>
    handler(parseRequest('Timba Night Saturday 8pm San Diego', {
      origin: 'https://cubansocial.com',
    })),
  );

  assertEquals(result.headers.get('Access-Control-Allow-Origin'), 'https://cubansocial.com');
});

Deno.test('returns incomplete parse response from n8n including questions array', async () => {
  setEnv();
  const { result } = await withN8nMock(N8N_INCOMPLETE_RESPONSE, 200, () =>
    handler(parseRequest('Timba Night free')),
  );

  const body = await result.json();
  assertEquals(body.status,           'incomplete');
  assertEquals(body.missing.length,   2);
  assertEquals(body.questions.length, 2);
});

// ---------------------------------------------------------------------------
// Tests — error handling
// ---------------------------------------------------------------------------

Deno.test('returns 503 upstream_unavailable when n8n is unreachable (network error)', async () => {
  setEnv();
  const res  = await withNetworkErrorMock(() =>
    handler(parseRequest('Timba Night Saturday 8pm San Diego')),
  );
  const body = await res.json();

  assertEquals(res.status, 503);
  assertEquals(body.error, 'upstream_unavailable');
});

Deno.test('503 response does not expose n8n URL or token', async () => {
  setEnv({ N8N_WEBHOOK_URL: 'https://secret-n8n-url.example.com/abc' });
  const res  = await withNetworkErrorMock(() =>
    handler(parseRequest('Timba Night Saturday 8pm San Diego')),
  );
  const text = await res.text();

  assertEquals(text.includes('secret-n8n-url.example.com'), false,
    'The n8n webhook URL must never appear in the response');
});

// ---------------------------------------------------------------------------
// Tests — rate limiting
// ---------------------------------------------------------------------------

Deno.test('allows the first 5 requests from the same IP within one minute', async () => {
  setEnv();
  const ip = `rate-limit-allow-${uniqueIp()}`;

  for (let i = 0; i < 5; i++) {
    const { result } = await withN8nMock(N8N_COMPLETE_RESPONSE, 200, () =>
      handler(new Request('https://fn.supabase.co/functions/v1/parse-event', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, 'Origin': 'https://cubansocial.com' },
        body:    JSON.stringify({ text: 'Timba Night Saturday 8pm San Diego free' }),
      })),
    );
    assertEquals(result.status, 200, `Request ${i + 1} should be allowed`);
  }
});

Deno.test('returns 429 rate_limited on the 6th request from the same IP', async () => {
  setEnv();
  const ip = `rate-limit-block-${uniqueIp()}`;

  // Exhaust the 5-request allowance
  for (let i = 0; i < 5; i++) {
    await withN8nMock(N8N_COMPLETE_RESPONSE, 200, () =>
      handler(new Request('https://fn.supabase.co/functions/v1/parse-event', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
        body:    JSON.stringify({ text: 'Timba Night Saturday 8pm San Diego free' }),
      })),
    );
  }

  // 6th request must be rejected
  const res = await handler(
    new Request('https://fn.supabase.co/functions/v1/parse-event', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body:    JSON.stringify({ text: 'Timba Night Saturday 8pm San Diego free' }),
    }),
  );
  const body = await res.json();

  assertEquals(res.status, 429);
  assertEquals(body.error, 'rate_limited');
});

Deno.test('different IPs are rate-limited independently', async () => {
  setEnv();
  const ipA = `indep-a-${uniqueIp()}`;
  const ipB = `indep-b-${uniqueIp()}`;

  // Exhaust IP A
  for (let i = 0; i < 5; i++) {
    await withN8nMock(N8N_COMPLETE_RESPONSE, 200, () =>
      handler(new Request('https://fn.supabase.co/functions/v1/parse-event', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ipA },
        body:    JSON.stringify({ text: 'Timba Night Saturday 8pm San Diego free' }),
      })),
    );
  }

  // IP B (fresh) should still be allowed
  const { result } = await withN8nMock(N8N_COMPLETE_RESPONSE, 200, () =>
    handler(new Request('https://fn.supabase.co/functions/v1/parse-event', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ipB },
      body:    JSON.stringify({ text: 'Timba Night Saturday 8pm San Diego free' }),
    })),
  );

  assertEquals(result.status, 200, 'IP B should not be rate-limited just because IP A was');
});
