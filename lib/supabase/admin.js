/**
 * Privileged (secret-key) Supabase client — server only.
 *
 * ⚠️  This client BYPASSES Row Level Security.
 *
 * Legitimate uses:
 *   - maintenance scripts (`scripts/seed-dev.mjs`, `scripts/grant-role.mjs`)
 *   - audited platform operations that genuinely need cross-user access and
 *     always write an audit log row through `lib/moderation/actions.js`
 *
 * It must never be imported into a client component, a page that renders user
 * input, or anything under `components/`.
 */

import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { supabasePublicConfig } from '@/lib/config';
import { serverConfig } from '@/lib/config.server';

/**
 * @returns {import('@supabase/supabase-js').SupabaseClient | null}
 */
export function getAdminClient() {
  const url = supabasePublicConfig.url;
  const secret = serverConfig.supabaseSecretKey;
  if (!url || !secret) return null;

  return createClient(url, secret, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { 'x-campus-plus-client': 'server-admin' },
    },
  });
}

export function requireAdminClient() {
  const client = getAdminClient();
  if (!client) {
    throw new Error(
      'Admin Supabase client unavailable. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in the server environment.',
    );
  }
  return client;
}
