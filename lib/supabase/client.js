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
  // The sandbox browser is remote: route fixture requests through the app,
  // never to the browser's own loopback interface. This is development-only.
  const localPreview = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_LOCAL_PREVIEW === '1';
  const url = localPreview ? `${window.location.origin}/api/preview-supabase` : supabasePublicConfig.url;
  const options = localPreview
    ? { cookieOptions: { name: `sb-${new URL(supabasePublicConfig.url).hostname.split('.')[0]}-auth-token` } }
    : undefined;
  cached = createBrowserClient(url, supabasePublicConfig.publishableKey, options);
  return cached;
}
