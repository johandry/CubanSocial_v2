// CubanSocial — Edge Function: notify-admin
// Triggered by Supabase Database Webhook on INSERT into events
// Sends an email to all admins via Resend

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY  = Deno.env.get('RESEND_API_KEY')!;
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY= Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req: Request) => {
  try {
    const body = await req.json();
    // Supabase Database Webhook payload: { type, table, record, old_record }
    const event = body.record;
    if (!event || event.status !== 'pending') {
      return new Response('not pending', { status: 200 });
    }

    // Fetch all admin emails using service role (bypasses RLS)
    const adminDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: admins } = await adminDb.from('admins').select('email');
    if (!admins?.length) return new Response('no admins', { status: 200 });

    const subject = `[CubanSocial] New event pending: ${event.name}`;
    const htmlBody = `
      <h2>New event submitted for review</h2>
      <p><strong>${event.name}</strong></p>
      <p>Submitted: ${new Date(event.created_at).toLocaleString('en-US')}</p>
      <p><a href="https://cubansocial.com/admin">Review in Admin Dashboard →</a></p>
    `;

    for (const admin of admins) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:    'noreply@cubansocial.com',
          to:      [admin.email],
          subject,
          html:    htmlBody,
        }),
      });
    }

    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error('[notify-admin]', err);
    return new Response('error', { status: 500 });
  }
});
