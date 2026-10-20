/**
 * Supabase auth cookies — the naming rule, defined once.
 *
 * `@supabase/ssr` stores the session under `sb-<project-ref>-auth-token`, and
 * splits it into `…-auth-token.0`, `…-auth-token.1`, … when the session is
 * larger than a single cookie. It also writes PKCE helpers with the same prefix
 * (`…-auth-token-code-verifier`, `…-auth-token-flow-<id>-code-verifier`,
 * `…-auth-token-flows-code-verifier`).
 *
 * Both halves of sign-out need to recognise "these are Supabase's cookies and
 * nobody else's": the browser checks that none survive after signing out, and
 * the server action deletes whatever is left. Keeping the rule in one module
 * means the two can never disagree. Campus+ owns no other `sb-` cookie
 * (`campus_intro` is the only other cookie the app sets).
 */

/** `sb-<ref>-auth-token`, its numbered chunks, and its PKCE companions. */
export const SUPABASE_AUTH_COOKIE = /^sb-[\w.-]*-auth-token(\.[0-9]+)?(-[\w.-]+)?$/;

/** Is this cookie one of Supabase's session cookies? */
export function isSupabaseAuthCookie(name) {
  return typeof name === 'string' && SUPABASE_AUTH_COOKIE.test(name);
}

/**
 * The Supabase auth cookies present in a `Cookie`-style header value
 * (`"a=1; sb-x-auth-token=…"`) or, with no argument, in `document.cookie`.
 *
 * @param {string} [cookieHeader]
 * @returns {string[]} cookie names, in the order they appear
 */
export function supabaseAuthCookieNames(cookieHeader = null) {
  const source = cookieHeader ?? (typeof document === 'undefined' ? '' : document.cookie);
  if (!source) return [];
  return source
    .split(';')
    .map((part) => part.trim().split('=')[0].trim())
    .filter((name) => name && isSupabaseAuthCookie(name));
}
