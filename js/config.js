/**
 * CubanSocial — Supabase client configuration
 * Replace placeholder values with your real project values.
 * NEVER commit real keys — use GitHub Secrets for production.
 *
 * For GitHub Pages, values are injected at build time via the
 * deploy workflow (see .github/workflows/deploy.yml).
 */

// These are the public anon key + project URL — safe to expose in frontend JS.
// The service-role key MUST stay in Edge Functions only.
const SUPABASE_URL  = '__SUPABASE_URL__';
const SUPABASE_ANON = '__SUPABASE_ANON_KEY__';

// Supabase Edge Function base URL (same project)
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

// Supabase client (loaded from CDN in index.html)
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON);

export { db, SUPABASE_URL, SUPABASE_ANON, FUNCTIONS_URL };
