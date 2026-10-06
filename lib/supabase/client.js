'use client';

/**
 * Browser Supabase client.
 *
 * Uses ONLY the publishable key — the secret key never reaches the browser
 * (spec §64, §91). Every privileged operation is gated by Row Level Security,
 * so this client is safe to expose.
 */

import { createBrowserClient } from '@supabase/ssr';
import { supabasePublicConfig } from '@/lib/config';

let cached = null;

export function isBrowserConfigured() {
  return supabasePublicConfig.isConfigured;
}

/**
 * @returns {import('@supabase/supabase-js').SupabaseClient | null}
 *   `null` when Supabase is not configured yet — callers show a setup state
 *   instead of crashing (spec §92).
 */
export function getBrowserClient() {
  if (!supabasePublicConfig.isConfigured) return null;
  if (cached) return cached;
  cached = createBrowserClient(supabasePublicConfig.url, supabasePublicConfig.publishableKey);
  return cached;
}
