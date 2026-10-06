/**
 * Server Supabase client (React Server Components, Server Actions, Route Handlers).
 *
 * Still the *publishable* key: all data access is subject to RLS and the user's
 * session cookie. The secret key is used only by `lib/supabase/admin.js`, which
 * is imported exclusively from maintenance scripts and audited admin operations.
 */

import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabasePublicConfig } from '@/lib/config';

/**
 * @returns {Promise<import('@supabase/supabase-js').SupabaseClient | null>}
 */
export async function getServerClient() {
  if (!supabasePublicConfig.isConfigured) return null;
  const cookieStore = await cookies();

  return createServerClient(supabasePublicConfig.url, supabasePublicConfig.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render: cookies are read-only there.
          // Session refresh is handled by the proxy (proxy.js) which can write.
        }
      },
    },
  });
}

/** Throws a descriptive error instead of returning null — for required paths. */
export async function requireServerClient() {
  const client = await getServerClient();
  if (!client) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
    );
  }
  return client;
}
