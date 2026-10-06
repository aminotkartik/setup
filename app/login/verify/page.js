import { redirect } from 'next/navigation';

export const metadata = { title: 'Sign in' };

// The redirect must be a real HTTP response, not a step baked into a
// prerendered page: old links to this route can be opened by anything.
export const dynamic = 'force-dynamic';

/**
 * Legacy step 2 of the one-time-code flow.
 *
 * The six-digit code was replaced by Google OAuth, so there is nothing to
 * verify on this route any more. It is kept — it is still part of the
 * documented route surface, and links in old emails and bookmarks point here —
 * and forwards to /login, which explains the new flow.
 *
 * No session logic lives here: sessions are created only in /auth/callback.
 */
export default function VerifyPage() {
  redirect('/login?notice=google');
}
