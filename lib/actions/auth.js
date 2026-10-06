'use server';

/**
 * Authentication server actions (spec §7, §8).
 *
 * Sign-in is Google OAuth only:
 *
 *   /login → Supabase `signInWithOAuth({ provider: 'google' })` → Google →
 *   `/auth/callback` (PKCE code exchange, server-side) → session cookie → profile.
 *
 * `startGoogleSignIn` deliberately does **not** create a session: it asks
 * Supabase for the Google authorization URL and returns it, and the browser
 * navigates. The session is created exactly once, on the server, in
 * `app/auth/callback/route.js`, and only for an `@pccoepune.org` account.
 *
 * Why the URL is returned instead of calling `redirect()` here: `redirect()`
 * reports success by *throwing* a control-flow error (`NEXT_REDIRECT`), which is
 * indistinguishable from a real failure inside a `try/catch`. The old
 * one-time-code action had exactly that bug — its `catch` swallowed the redirect
 * and showed "something went wrong" after a successful sign-in. Returning the
 * URL removes the class of bug entirely: no `redirect()` runs inside this
 * action, so there is nothing for the error handling to swallow.
 */

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getServerClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/session';
import { buildCallbackUrl, GOOGLE_PROVIDER, originFromHeaders, safeNextPath } from '@/lib/auth/oauth';
import { validate, onboardingSchema } from '@/lib/validation/schemas';
import { fromPostgresError, errors, toActionError } from '@/lib/errors';

/**
 * Where the browser must go to start the Google round trip.
 *
 * No session and no cookie are created here — `signInWithOAuth` only writes the
 * PKCE code verifier (as a cookie, through `@supabase/ssr`) that
 * `/auth/callback` needs to complete the exchange.
 */
export async function startGoogleSignIn(formData) {
  try {
    const supabase = await getServerClient();
    if (!supabase) throw errors.configuration('Campus+ is not connected to a Supabase project yet.');

    // The public origin comes from the request headers rather than from the
    // form: a client-supplied value must never decide where OAuth returns to.
    const origin = originFromHeaders(await headers());
    if (!origin) {
      throw errors.configuration(
        'Sign-in needs the public HTTPS address of this deployment. Check the Supabase redirect URL settings and try again.',
      );
    }

    const next = safeNextPath(formData?.get?.('next'));
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: GOOGLE_PROVIDER,
      options: {
        redirectTo: buildCallbackUrl(origin, next),
        // The server has no browser to redirect; the caller navigates to `url`.
        skipBrowserRedirect: true,
      },
    });

    if (error || !data?.url) {
      throw errors.validation('We could not reach Google. Please try again in a moment.');
    }

    return { ok: true, url: data.url };
  } catch (error) {
    return toActionError(error, 'We could not start Google sign-in. Please try again.');
  }
}

/**
 * Finish onboarding: claim the username and fill in the public profile.
 * `complete_profile()` is the only supported path — it owns uniqueness,
 * reserved names, the cooldown rule and the audit entry.
 *
 * Unchanged by the move to Google OAuth: the profile is still created once, by
 * the signup trigger, and this action only completes it.
 */
export async function completeOnboarding(formData) {
  try {
    const user = await getCurrentUser();
    if (!user) throw errors.unauthenticated();

    const payload = {
      username: formData.get('username'),
      display_name: formData.get('display_name'),
      bio: formData.get('bio'),
      branch: formData.get('branch'),
      year: formData.get('year'),
      division: formData.get('division'),
      show_branch_year: formData.get('show_branch_year') !== null ? formData.get('show_branch_year') : true,
      accept_rules: formData.get('accept_rules'),
    };

    const checked = validate(payload, onboardingSchema);
    if (!checked.ok) throw errors.validation('Please check the highlighted fields.', checked.errors);
    const values = checked.data;

    const supabase = await getServerClient();
    const { data, error } = await supabase.rpc('complete_profile', {
      p_username: values.username,
      p_display_name: values.display_name,
      p_bio: values.bio || null,
      p_branch: values.branch || null,
      p_year: values.year || null,
      p_division: values.division || null,
      p_show_branch_year: values.show_branch_year !== false,
    });
    if (error) throw fromPostgresError(error);

    revalidatePath('/', 'layout');
    return { ok: true, profile: data };
  } catch (error) {
    return toActionError(error, 'We could not save your profile. Please try again.');
  }
}
