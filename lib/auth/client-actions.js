'use client';

/**
 * Session helpers that run in the browser.
 *
 * They exist so the UI can react quickly (sign-out, realtime auth hand-off),
 * but every one of them is duplicated by a server-side check. Nothing here is
 * a security boundary.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserClient } from '@/lib/supabase/client';

/** Sign the current user out and return them to the sign-in screen. */
export function useSignOut() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const signOut = useCallback(async () => {
    setPending(true);
    setError(null);
    const supabase = getBrowserClient();
    try {
      if (supabase) {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) throw signOutError;
      }
      router.replace('/login');
      router.refresh();
    } catch (err) {
      console.error('[Campus+] Sign out failed:', err);
      setError(err?.message || 'Failed to sign out. Please try again.');
    } finally {
      setPending(false);
    }
  }, [router]);

  return { signOut, pending, error };
}

/**
 * Auth state for realtime subscriptions. `getSession()` is used here only to
 * pass the token to Realtime — authorization itself is enforced by RLS and by
 * private-channel policies server-side.
 */
export function useRealtimeAuth() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = getBrowserClient();
    if (!supabase) return undefined;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.access_token) {
        await supabase.realtime.setAuth(data.session.access_token);
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return ready;
}
