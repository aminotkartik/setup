/**
 * Google OAuth callback (spec §7, §8).
 *
 * This is the only place a Campus+ session is created. The flow is:
 *
 *   1. Google returns `?code=…` (PKCE authorization code) to this route,
 *   2. the code is exchanged **server-side** for a session with the code
 *      verifier cookie that `startGoogleSignIn` wrote,
 *   3. the authenticated address is re-checked against the institutional
 *      allow-list, and a session that fails the check is signed out again,
 *   4. the browser is sent into the app (or back to /login with a reason).
 *
 * The session cookie therefore never depends on anything the browser claims:
 * the address is read from Supabase (Google-verified), not from a form field.
 */

import { NextResponse } from 'next/server';
import { getServerClient } from '@/lib/supabase/server';
import { checkInstitutionalEmail } from '@/lib/auth/domains';
import { loginErrorPath, OAUTH_CALLBACK_PATH, originFromHeaders, safeNextPath } from '@/lib/auth/oauth';
import { logError } from '@/lib/errors';
import { ROUTES } from '@/lib/constants';

// Reads the PKCE code and session cookies: never cached, never prerendered.
export const dynamic = 'force-dynamic';

/** Send the browser back to /login with a reason the screen can explain. */
function fail(origin, reason) {
  return NextResponse.redirect(new URL(loginErrorPath(reason), origin));
}

export async function GET(request) {
  const url = new URL(request.url);
  // Behind a proxy (Vercel, preview tunnels) the forwarded host is the address
  // the student actually used; fall back to the one Next reconstructed.
  const origin = originFromHeaders(request.headers, url.origin);

  const code = url.searchParams.get('code');
  const providerError = url.searchParams.get('error');
  const next = safeNextPath(url.searchParams.get('next'));

  // The student cancelled at Google, or the provider refused the request.
  if (providerError) {
    if (providerError !== 'access_denied') {
      logError(new Error(`Google OAuth error: ${providerError}`), { route: OAUTH_CALLBACK_PATH });
    }
    return fail(origin, providerError === 'access_denied' ? 'cancelled' : 'provider');
  }

  if (!code) return fail(origin, 'missing_code');

  const supabase = await getServerClient();
  if (!supabase) return fail(origin, 'not_configured');

  // PKCE exchange: the code is single-use, short-lived and bound to the
  // verifier cookie written when the round trip started.
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data?.user) {
    logError(error || new Error('OAuth callback returned no user'), { route: OAUTH_CALLBACK_PATH });
    return fail(origin, 'exchange');
  }

  // Defence in depth: the signup trigger rejects other domains in the database
  // and Supabase Auth's own allow-list is a third layer, but the application
  // re-checks the Google-verified address before letting the session in.
  const check = await checkInstitutionalEmail(data.user.email, supabase);
  if (!check.ok) {
    // A session for an address that is not allowed must not survive.
    await supabase.auth.signOut();
    return fail(origin, 'domain');
  }

  return NextResponse.redirect(new URL(next || ROUTES.home, origin));
}
