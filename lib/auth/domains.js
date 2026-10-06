/**
 * Institutional domain gate.
 *
 * Defence in depth (spec §8):
 *   1. this module  — server-side check used by the sign-in route/action
 *   2. database     — `public.allowed_email_domain(text)` + a trigger on
 *                     auth.users that REJECTS other domains at insert time
 *   3. Supabase Auth — configure the same restriction in the dashboard
 *                     (Auth → Sign In / Providers → email domain allow-list)
 *
 * The frontend never decides who may sign in.
 */

import 'server-only';
import { serverConfig } from '@/lib/config.server';
import { emailDomain, formatDomain, normalizeEmail } from '@/lib/utils';
import { vInstitutionalEmail } from '@/lib/validation/schemas';

/** Domain list: database platform setting first, environment variable as fallback. */
export async function getAllowedDomains(supabase = null) {
  if (supabase) {
    try {
      const { data } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'allowed_email_domains')
        .maybeSingle();
      const parsed = Array.isArray(data?.value) ? data.value : null;
      if (parsed?.length) {
        return parsed.map((d) => String(d).toLowerCase().replace(/^@/, '')).filter(Boolean);
      }
    } catch {
      // Database not migrated yet — fall through to the environment default so
      // the app still boots with a clear, non-fabricated configuration.
    }
  }
  return serverConfig.allowedEmailDomains;
}

/** Is this address from an allowed institution? */
export function isAllowedInstitutionalEmail(email, domains) {
  return vInstitutionalEmail(email, { domains }).ok;
}

export function domainOf(email) {
  return emailDomain(normalizeEmail(email));
}

export function describeDomains(domains) {
  return (domains || []).map(formatDomain).join(' or ');
}

/**
 * Normalises any pasted address and returns a rich result the UI can render.
 */
export async function checkInstitutionalEmail(rawEmail, supabase = null) {
  const domains = await getAllowedDomains(supabase);
  const email = normalizeEmail(rawEmail);
  const result = vInstitutionalEmail(email, { domains });
  if (!result.ok) return { ok: false, error: result.error, email, domain: domainOf(email), domains };
  return { ok: true, email: result.value, domain: domainOf(result.value), domains };
}
