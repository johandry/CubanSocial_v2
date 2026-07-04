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

/**
 * Exported for testing. Reads env vars at request time so tests can
 * inject values via Deno.env.set() before calling this function.
 */
export async function handler(req: Request): Promise<Response> {
  const N8N_WEBHOOK_URL   = Deno.env.get('N8N_WEBHOOK_URL') ?? '';
  const N8N_WEBHOOK_TOKEN = Deno.env.get('N8N_WEBHOOK_TOKEN') ?? '';

  // CORS for GitHub Pages origin
  const origin  = req.headers.get('origin') ?? '';
  const allowed = origin.endsWith('cubansocial.com') || origin.includes('github.io');
  const corsHeaders: Record<string, string> = allowed
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type' }
    : {};

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST')    return new Response('Method not allowed', { status: 405 });

  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  if (isRateLimited(ip)) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: corsHeaders });
  }

  // Validate minimum required fields
  const payload = body as Record<string, unknown>;
  if (typeof payload.text !== 'string' || payload.text.trim().length < 5) {
    return new Response(JSON.stringify({ error: 'text_required' }), { status: 400, headers: corsHeaders });
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
      status: n8nRes.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[parse-event] n8n error:', err);
    return new Response(JSON.stringify({ error: 'upstream_unavailable' }), {
      status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// Start the HTTP server only when deployed as a Supabase Edge Function,
// not when this module is imported by the test runner.
if (import.meta.main) {
  serve(handler);
}

