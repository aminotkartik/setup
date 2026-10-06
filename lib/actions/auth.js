'use server';

/**
 * Authentication server actions (spec §7, §8).
 *
 * Passwordless email OTP only:
 *   email → one-time code from Supabase Auth → session cookie → profile.
 *
 * There is no password, no PRN and no client-side-only domain check:
 *   1. `checkInstitutionalEmail()` rejects other domains before any mail is sent,
 *   2. the database trigger `enforce_institutional_domain()` rejects them again
 *      even if someone calls the Auth API directly,
 *   3. Supabase Auth's own domain allow-list is the third layer.
 */

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getServerClient } from '@/lib/supabase/server';
import { requireAdminClient } from '@/lib/supabase/admin';
import { checkInstitutionalEmail } from '@/lib/auth/domains';
import { getCurrentUser } from '@/lib/auth/session';
import { validate, onboardingSchema } from '@/lib/validation/schemas';
import { fromPostgresError, errors, toActionError } from '@/lib/errors';
import { ROUTES } from '@/lib/constants';

const OTP_EMAIL_OPTIONS = {
  shouldCreateUser: true,
  // Any deep link back into the app; the code is the primary path.
  emailRedirectTo: undefined,
};

/** Step 1 — validate the address, rate limit, and send the code. */
export async function sendLoginCode(formData) {
  const rawEmail = formData.get('email');
  try {
    const supabase = await getServerClient();
    if (!supabase) throw errors.configuration('Campus+ is not connected to a Supabase project yet.');

    const check = await checkInstitutionalEmail(rawEmail, supabase);
    if (!check.ok) throw errors.validation(check.error, { email: check.error });

    // Pre-authentication limits need the secret key, because there is no
    // profile id to key the counter on yet (spec §61).
    const admin = requireAdminClient();
    const { data: limit } = await admin.rpc('consume_rate_limit', {
      p_bucket: 'otp_request',
      p_key: check.email,
      p_limit: 5,
      p_window_seconds: 3600,
    });
    if (limit && limit.allowed === false) {
      const minutes = Math.max(1, Math.ceil(Number(limit.retry_after_seconds || 60) / 60));
      throw errors.rateLimited(
        `Too many codes requested for this address. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      );
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: check.email,
      options: { ...OTP_EMAIL_OPTIONS, emailRedirectTo: undefined },
    });
    if (error) {
      // Supabase returns a generic error here; surface it plainly.
      throw errors.validation(
        /rate|too many/i.test(error.message)
          ? 'Too many codes requested. Please wait a few minutes and try again.'
          : 'We could not send the code. Check the address and try again.',
        { email: 'Could not send a code to this address.' },
      );
    }

    redirect(`/login/verify?email=${encodeURIComponent(check.email)}`);
  } catch (error) {
    const result = toActionError(error, 'We could not send the code. Try again in a moment.');
    // `redirect()` throws a control-flow error that must not be swallowed.
    if (typeof error?.digest === 'string' && error.digest.startsWith('NEXT_REDIRECT')) throw error;
    return result;
  }
}

/** Step 2 — verify the code and establish the session. */
export async function verifyLoginCode(formData) {
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const token = String(formData.get('token') || '').replace(/\s+/g, '');
  try {
    const supabase = await getServerClient();
    if (!supabase) throw errors.configuration('Campus+ is not connected to a Supabase project yet.');
    if (!/^\d{6}$/.test(token)) {
      throw errors.validation('Enter the six-digit code from the email.', { token: 'Six digits.' });
    }

    const admin = requireAdminClient();
    const { data: limit } = await admin.rpc('consume_rate_limit', {
      p_bucket: 'otp_verify',
      p_key: email || 'unknown',
      p_limit: 10,
      p_window_seconds: 3600,
    });
    if (limit && limit.allowed === false) {
      throw errors.rateLimited('Too many attempts. Request a new code in a few minutes.');
    }

    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error || !data?.user) {
      throw errors.validation('That code is not valid or has expired. Request a new one.', {
        token: 'Invalid or expired code.',
      });
    }

    revalidatePath('/', 'layout');
    redirect(ROUTES.home);
  } catch (error) {
    if (typeof error?.digest === 'string' && error.digest.startsWith('NEXT_REDIRECT')) throw error;
    return toActionError(error, 'We could not verify that code. Try again.');
  }
}

/** Send a fresh code for the address already on the verify screen. */
export async function resendLoginCode(formData) {
  return sendLoginCode(formData);
}

/**
 * Finish onboarding: claim the username and fill in the public profile.
 * `complete_profile()` is the only supported path — it owns uniqueness,
 * reserved names, the cooldown rule and the audit entry.
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
