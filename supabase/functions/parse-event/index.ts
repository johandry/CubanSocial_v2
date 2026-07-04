// CubanSocial — Edge Function: parse-event
// Proxy between the browser and n8n AI Agent webhook.
// The n8n URL and secret token are NEVER exposed to the client.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

// Simple rate limiting: max 5 requests per IP per minute (in-memory, resets on cold start)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT   = 5;
const WINDOW_MS    = 60_000;

function isRateLimited(ip: string): boolean {
  const now   = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  return false;
}

/** Returns CORS headers when the origin is an allowed domain; empty object otherwise. */
function buildCorsHeaders(origin: string): Record<string, string> {
  const allowed = origin.endsWith('cubansocial.com') || origin.includes('github.io');
  if (!allowed) return {};
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

/** Convenience: return a JSON error response with optional extra headers. */
function jsonError(
  code: string,
  status: number,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { ...extra, 'Content-Type': 'application/json' },
  });
}

/**
 * Exported for testing. Reads env vars at request time so tests can
 * inject values via Deno.env.set() before calling this function.
 */
export async function handler(req: Request): Promise<Response> {
  const N8N_WEBHOOK_URL   = Deno.env.get('N8N_WEBHOOK_URL') ?? '';
  const N8N_WEBHOOK_TOKEN = Deno.env.get('N8N_WEBHOOK_TOKEN') ?? '';

  const cors = buildCorsHeaders(req.headers.get('origin') ?? '');

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST')    return new Response('Method not allowed', { status: 405 });

  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  if (isRateLimited(ip)) return jsonError('rate_limited', 429, cors);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('invalid_json', 400, cors);
  }

  const payload = body as Record<string, unknown>;
  if (typeof payload.text !== 'string' || payload.text.trim().length < 5) {
    return jsonError('text_required', 400, cors);
  }

  // Forward to n8n with secret token
  try {
    const n8nRes = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'X-Webhook-Token': N8N_WEBHOOK_TOKEN,
      },
      body: JSON.stringify({ text: payload.text, clarifications: payload.clarifications ?? {} }),
    });

    const data = await n8nRes.json();
    return new Response(JSON.stringify(data), {
      status:  n8nRes.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[parse-event] n8n error:', err);
    return jsonError('upstream_unavailable', 503, cors);
  }
}

// Start the HTTP server only when deployed as a Supabase Edge Function,
// not when this module is imported by the test runner.
if (import.meta.main) {
  serve(handler);
}


