/**
 * The sign-out itself — pure async logic, no React, no Next.js imports.
 *
 * This module exists so the one piece of behaviour that has to be *right* can be
 * exercised directly (unit tests with fake clients, and the browser-client probe
 * in `scripts/dev/verify-signout.mjs`) instead of only through a click handler.
 *
 * The rules it enforces, in order:
 *
 *   1. Ask the configured browser client to sign out. `supabase.auth.signOut()`
 *      revokes the refresh token and deletes the cookies `@supabase/ssr` wrote
 *      (default `scope: 'global'`).
 *   2. Inspect the *returned* error and catch thrown exceptions. Neither is
 *      ignored: auth-js clears the local session even when the revoke call
 *      fails, so an error is not by itself proof that the device is still
 *      signed in — and the absence of an error is not proof either.
 *   3. Verify the device instead of trusting the return value: no
 *      `sb-*-auth-token` cookie may remain and `getSession()` must be empty.
 *   4. If anything survived, run the server-side fallback (`endSession`, passed
 *      in by the caller). A Server Action is the one place a cookie can always
 *      be deleted, because it writes `Set-Cookie` on its own response.
 *   5. Only when the device really is signed out does this resolve. Otherwise it
 *      throws an `Error` whose message is safe to show the student — sign-out
 *      never reports success it cannot demonstrate.
 *
 * Nothing here logs tokens, cookies or their values.
 */

import { supabaseAuthCookieNames } from '@/lib/auth/cookies';

/** Copy shown when the session could not be ended on this device. */
export const SIGN_OUT_FAILED =
  'We could not sign you out. You are still signed in — check your connection and try again.';

/**
 * @param {object} options
 * @param {import('@supabase/supabase-js').SupabaseClient|null} options.client
 *   the configured browser client (may be null when Supabase is not configured)
 * @param {() => string} options.readCookies
 *   returns a `Cookie`-header-style string for the current document
 * @param {() => Promise<{ok?: boolean, error?: string}|void>} [options.clearOnServer]
 *   server-side fallback that deletes the auth cookies; omitted in tests that do
 *   not exercise it
 * @returns {Promise<{ revokedByServer: boolean, clearedByBrowser: boolean }>}
 * @throws {Error} when the device is still signed in afterwards
 */
export async function completeSignOut({ client, readCookies, clearOnServer = null }) {
  let revokedByServer = true;

  // 1 + 2 — ask the browser client, and read the answer honestly.
  if (client) {
    try {
      const { error } = await client.auth.signOut();
      if (error) {
        revokedByServer = false;
        // The message is the library's, not the session's: safe to log, and it
        // is what makes a flaky sign-out diagnosable in a support report.
        console.warn('[Campus+] Supabase sign-out reported an error:', error.message || error);
      }
    } catch (thrown) {
      revokedByServer = false;
      console.warn('[Campus+] Supabase sign-out threw:', thrown?.message || thrown);
    }
  } else {
    revokedByServer = false;
    console.warn('[Campus+] No browser Supabase client is configured; using the server fallback.');
  }

  // 3 — the device decides, not the return value.
  if (!(await deviceSignedIn({ client, readCookies }))) {
    return { revokedByServer, clearedByBrowser: true };
  }

  // 4 — last resort: the server can always delete the cookie.
  let clearedByServer = false;
  if (clearOnServer) {
    try {
      const result = await clearOnServer();
      clearedByServer = result?.ok !== false;
      if (!clearedByServer) {
        console.warn(
          '[Campus+] Server sign-out fallback failed:',
          result?.error || 'the server did not confirm the session had ended',
        );
      }
    } catch (thrown) {
      console.warn('[Campus+] Server sign-out fallback threw:', thrown?.message || thrown);
    }
  }

  if (await deviceSignedIn({ client, readCookies })) {
    throw new Error(SIGN_OUT_FAILED);
  }

  // `revokedByServer` answers one question for the caller and the verification
  // harness: was the session ended on the server by *either* half of sign-out?
  return { revokedByServer: revokedByServer || clearedByServer, clearedByBrowser: false };
}

/**
 * Is this device still holding an authenticated session?
 *
 * The cookies are checked first because they are what the server actually
 * sees — a live `sb-*-auth-token` cookie is a live session for every page, the
 * proxy and every Server Action, whatever the client thinks.
 */
async function deviceSignedIn({ client, readCookies }) {
  if (supabaseAuthCookieNames(readCookies()).length > 0) return true;
  if (!client) return false;
  try {
    const { data } = await client.auth.getSession();
    return Boolean(data?.session);
  } catch {
    // Storage unavailable and no cookie left: there is nothing that could still
    // authenticate a request.
    return false;
  }
}
