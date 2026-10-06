/**
 * Google OAuth helpers (spec §7, §8).
 *
 * Campus+ has no passwords and no one-time codes: the only way in is
 * "Continue with Google", and the session is created server-side in
 * `/auth/callback` after a PKCE authorization-code exchange.
 *
 * Everything in this module is pure and free of `next/*` and `server-only`
 * imports, so the sign-in screen (browser), the callback route (server) and the
 * unit tests all share exactly the same rules.
 */

/** The one and only sign-in provider. */
export const GOOGLE_PROVIDER = 'google';

/** Where Supabase returns the authorization code. */
export const OAUTH_CALLBACK_PATH = '/auth/callback';

/** Query parameter the callback uses to send a failure back to /login. */
export const AUTH_ERROR_PARAM = 'error';

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/** First value of a comma-separated proxy header (`a, b` → `a`). */
function firstHeaderValue(value) {
  return String(value || '').split(',')[0].trim();
}

/**
 * A usable public origin, or null. HTTPS is required everywhere except local
 * development — Google refuses non-HTTPS redirect URIs, so a misconfigured
 * deployment fails here with a clear message instead of at Google.
 */
export function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    const isLocal = LOCAL_HOSTS.test(url.host);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Rebuild the deployment's public origin from the request headers, because a
 * Server Action has no `request.url`. Proxies (Vercel, tunnel previews) set
 * `x-forwarded-host`; a direct request only sets `host`.
 */
export function originFromHost(hostHeader, protocolHeader = null) {
  const host = firstHeaderValue(hostHeader);
  if (!host) return null;
  const protocol = firstHeaderValue(protocolHeader) || (LOCAL_HOSTS.test(host) ? 'http' : 'https');
  return normalizeOrigin(`${protocol}://${host}`);
}

/** Same as `originFromHost`, for anything exposing a `Headers`-like `get()`. */
export function originFromHeaders(headers, fallback = null) {
  if (!headers || typeof headers.get !== 'function') return fallback;
  return (
    originFromHost(headers.get('x-forwarded-host') || headers.get('host'), headers.get('x-forwarded-proto')) ||
    fallback
  );
}

/**
 * Only same-origin, absolute-path redirects are honoured after sign-in.
 *
 * A `next` value pointing at another origin (`https://evil.example`), at a
 * protocol-relative host (`//evil.example`) or at a scheme (`javascript:`) is
 * ignored, so `/auth/callback` can never be used as an open redirect.
 */
export function safeNextPath(value) {
  if (typeof value !== 'string') return null;
  const next = value.trim();
  if (!next.startsWith('/') || next.startsWith('//')) return null;
  // Browsers treat a backslash like a slash, so `/\evil.example` must not pass.
  if (next.includes('\\')) return null;
  if (/[\u0000-\u001f\u007f]/.test(next)) return null;
  return next;
}

/**
 * The absolute URL Supabase must return to: `<origin>/auth/callback`, carrying
 * the (validated) post-sign-in destination when there is one.
 */
export function buildCallbackUrl(origin, next = null) {
  const base = normalizeOrigin(origin);
  if (!base) throw new Error('A public HTTPS origin is required to build the OAuth callback URL.');
  const url = new URL(`${base}${OAUTH_CALLBACK_PATH}`);
  const safeNext = safeNextPath(next);
  if (safeNext) url.searchParams.set('next', safeNext);
  return url.toString();
}

/** Where the callback sends a failed sign-in attempt. */
export function loginErrorPath(code) {
  return `/login?${AUTH_ERROR_PARAM}=${encodeURIComponent(code)}`;
}

/** User-facing copy for every way sign-in can fail, keyed by URL parameter. */
export const AUTH_ERROR_MESSAGES = {
  cancelled: 'Google sign-in was cancelled. Use the button below when you are ready.',
  domain:
    'That Google account is not a PCCOE address. Sign in with the account that ends in @pccoepune.org.',
  exchange:
    'We could not complete the sign-in. Start again from this screen — if it keeps happening, tell an administrator.',
  missing_code: 'That sign-in link has expired. Use the button below to start again.',
  not_configured: 'Sign-in is not connected to Supabase on this deployment yet.',
  provider: 'Google could not complete the sign-in. Please try again in a moment.',
};

export function describeAuthError(code) {
  if (typeof code !== 'string') return null;
  return AUTH_ERROR_MESSAGES[code] || 'We could not complete that sign-in. Please try again.';
}
