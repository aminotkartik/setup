/**
 * Rate limiting (spec §61).
 *
 * Deliberately simple and storage-light: the Postgres function
 * `public.consume_rate_limit()` keeps one row per (bucket, key) with a rolling
 * window counter. No Redis, no external service (spec §90). The function is
 * SECURITY DEFINER, so the browser cannot reset or forge counters through RLS.
 */

import 'server-only';
import { RATE_LIMITS } from '@/lib/constants';
import { errors } from '@/lib/errors';

/**
 * @param {object} supabase  user-scoped Supabase client
 * @param {keyof typeof RATE_LIMITS} bucket
 * @param {string} [identifier] defaults to the authenticated user id, or 'anon'
 */
export async function consumeRateLimit(supabase, bucket, identifier = null) {
  const config = RATE_LIMITS[bucket];
  if (!config) throw new Error(`Unknown rate limit bucket: ${bucket}`);
  if (!supabase) return { allowed: true, remaining: config.limit, retryAfterSeconds: 0 };

  const { data, error } = await supabase.rpc('consume_rate_limit', {
    p_bucket: bucket,
    p_key: identifier || 'anon',
    p_limit: config.limit,
    p_window_seconds: config.windowSeconds,
  });

  if (error) {
    // Never let a rate-limit infrastructure hiccup take the product down;
    // log it and allow the request, but keep the message honest.
    console.warn('[campus+] rate limit unavailable:', error.message);
    return { allowed: true, remaining: config.limit, retryAfterSeconds: 0, degraded: true };
  }

  return {
    allowed: data?.allowed !== false,
    remaining: Number(data?.remaining ?? 0),
    retryAfterSeconds: Number(data?.retry_after_seconds ?? 0),
    limit: config.limit,
  };
}

/** Throws a friendly 429 when the bucket is exhausted. */
export async function enforceRateLimit(supabase, bucket, identifier = null) {
  const result = await consumeRateLimit(supabase, bucket, identifier);
  if (!result.allowed) {
    const minutes = Math.max(1, Math.ceil(result.retryAfterSeconds / 60));
    throw errors.rateLimited(
      `You have reached the limit for ${RATE_LIMITS[bucket]?.label || 'this action'}. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      { retryAfterSeconds: result.retryAfterSeconds },
    );
  }
  return result;
}

/** Human-readable summary for the settings/admin screens. */
export function rateLimitSummary() {
  return Object.entries(RATE_LIMITS).map(([bucket, config]) => ({
    bucket,
    limit: config.limit,
    windowSeconds: config.windowSeconds,
    label: config.label,
  }));
}
