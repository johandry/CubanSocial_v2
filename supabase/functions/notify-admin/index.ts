// CubanSocial — Edge Function: notify-admin
// Triggered by Supabase Database Webhook on INSERT into events
// Sends an email to all admins via Resend

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_URL = 'https://api.resend.com/emails';

/** Build the subject line and HTML body for a new-event notification. */
function buildNotificationEmail(event: Record<string, unknown>) {
  return {
    subject: `[CubanSocial] New event pending: ${event.name}`,
    html: `
      <h2>New event submitted for review</h2>
      <p><strong>${event.name}</strong></p>
      <p>Submitted: ${new Date(String(event.created_at)).toLocaleString('en-US')}</p>
      <p><a href="https://cubansocial.com/admin">Review in Admin Dashboard →</a></p>
    `,
  };
}

/** Send a single admin notification email via Resend. */
async function sendAdminEmail(
  to: string,
  subject: string,
  html: string,
  apiKey: string,
): Promise<void> {
  await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from: 'noreply@cubansocial.com',
      to:   [to],
      subject,
      html,
    }),
  });
}

/**
 * Exported for testing. Reads env vars at request time so tests can
 * inject values via Deno.env.set() before calling this function.
 */
export async function handler(req: Request): Promise<Response> {
  const RESEND_API_KEY   = Deno.env.get('RESEND_API_KEY') ?? '';
  const SUPABASE_URL     = Deno.env.get('SUPABASE_URL') ?? '';
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  try {
    const body = await req.json();
    // Supabase Database Webhook payload: { type, table, record, old_record }
    const event = body.record;
    if (!event || event.status !== 'pending') {
      return new Response('not pending', { status: 200 });
    }

    // Fetch all admin emails using service role (bypasses RLS)
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: admins } = await supabase.from('admins').select('email');
    if (!admins?.length) return new Response('no admins', { status: 200 });

    const { subject, html } = buildNotificationEmail(event);
    for (const admin of admins) {
      await sendAdminEmail(admin.email, subject, html, RESEND_API_KEY);
    }

    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error('[notify-admin]', err);
    return new Response('error', { status: 500 });
  }
}

// Start the HTTP server only when deployed as a Supabase Edge Function,
// not when this module is imported by the test runner.
if (import.meta.main) {
  serve(handler);
}
