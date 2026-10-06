/**
 * Configuration — the browser-safe half.
 *
 * Only values that are already public (or absent) live here, so this module can
 * be imported from client components without pulling `server-only` into the
 * browser bundle. Secrets live in `lib/config.server.js`.
 */

function readPublic(name) {
  const value = process.env[name];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || /^YOUR_|^your_/.test(trimmed)) return null;
  return trimmed;
}

/** Public Supabase configuration (safe for the browser). */
export const supabasePublicConfig = {
  get url() {
    return readPublic('NEXT_PUBLIC_SUPABASE_URL');
  },
  get publishableKey() {
    return readPublic('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  },
  get isConfigured() {
    return Boolean(this.url && this.publishableKey);
  },
};

/** True when the two client-side Supabase values are present. */
export function isSupabaseConfigured() {
  return supabasePublicConfig.isConfigured;
}
