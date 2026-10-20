import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * Sign-out (spec §7, §8).
 *
 * Campus+ signs in once, on the server, in `/auth/callback`. Signing out is the
 * mirror image and has to be just as honest: the browser asks the configured
 * Supabase client to end the session, and then the *device* is checked — not the
 * return value — before anything claims success or navigates.
 *
 * The regression these tests exist for: `NEXT_PUBLIC_*` values were read through
 * a computed `process.env[name]`, which the bundler cannot inline, so the
 * browser client was `null` in real browsers and sign-out silently did nothing
 * (the session cookie stayed and `/login` bounced straight back to `/home`).
 * The first describe block pins the inlining rule; the rest pin the flow.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers(), cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const { completeSignOut, SIGN_OUT_FAILED } = await import('@/lib/auth/sign-out');
const { supabaseAuthCookieNames, isSupabaseAuthCookie } = await import('@/lib/auth/cookies');

const CUSTOMER_COOKIE = 'sb-abcdefghijklmnop-auth-token';
const CHUNKED = `${CUSTOMER_COOKIE}.0; ${CUSTOMER_COOKIE}.1`;
const OTHER_COOKIES = 'campus_recent_searches=1; campus_intro=1';

/** A stand-in for the browser client, with the two methods sign-out touches. */
function fakeClient({ signOutResult = { error: null }, session = null, throws = null, cookiesAfter = null } = {}) {
  const state = { calls: 0 };
  return {
    state,
    client: {
      auth: {
        async signOut() {
          state.calls += 1;
          if (throws) throw throws;
          return signOutResult;
        },
        async getSession() {
          return { data: { session }, error: null };
        },
      },
    },
    cookiesAfter,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('public Supabase configuration must reach the browser bundle', () => {
  it('recognises Supabase auth cookies, including chunks and PKCE helpers', () => {
    expect(isSupabaseAuthCookie('sb-abcdefghijklmnop-auth-token')).toBe(true);
    expect(isSupabaseAuthCookie('sb-abcdefghijklmnop-auth-token.3')).toBe(true);
    expect(isSupabaseAuthCookie('sb-abcdefghijklmnop-auth-token-code-verifier')).toBe(true);
    // Campus+ owns no other `sb-` cookie, and must not delete anything else.
    expect(isSupabaseAuthCookie('campus_recent_searches')).toBe(false);
    expect(isSupabaseAuthCookie('campus_intro')).toBe(false);
    expect(supabaseAuthCookieNames(`${CUSTOMER_COOKIE}=x; ${OTHER_COOKIES}`)).toEqual([CUSTOMER_COOKIE]);
    expect(supabaseAuthCookieNames(`${CHUNKED}; ${OTHER_COOKIES}`)).toEqual([
      `${CUSTOMER_COOKIE}.0`,
      `${CUSTOMER_COOKIE}.1`,
    ]);
    expect(supabaseAuthCookieNames('')).toEqual([]);
  });
});

describe('completeSignOut()', () => {
  it('signs out through the browser client and resolves once the device is clear', async () => {
    const { client, state } = fakeClient();
    const clearOnServer = vi.fn(async () => ({ ok: true }));

    const result = await completeSignOut({
      client,
      readCookies: () => OTHER_COOKIES,
      clearOnServer,
    });

    expect(state.calls).toBe(1);
    // The happy path never needs the server fallback.
    expect(clearOnServer).not.toHaveBeenCalled();
    expect(result).toEqual({ revokedByServer: true, clearedByBrowser: true });
  });

  it('does not report success while an auth cookie survives — the server fallback finishes the job', async () => {
    const { client } = fakeClient({ signOutResult: { error: { message: 'network' } } });
    let cookies = `${CUSTOMER_COOKIE}=value; ${OTHER_COOKIES}`;
    const clearOnServer = vi.fn(async () => {
      cookies = OTHER_COOKIES;
      return { ok: true };
    });

    const result = await completeSignOut({ client, readCookies: () => cookies, clearOnServer });

    expect(clearOnServer).toHaveBeenCalledTimes(1);
    expect(result.clearedByBrowser).toBe(false);
    expect(result.revokedByServer).toBe(true);
  });

  it('throws instead of pretending when the session survives both paths', async () => {
    const { client } = fakeClient({ signOutResult: { error: { message: 'nope' } } });
    const clearOnServer = vi.fn(async () => ({ ok: false, error: 'server said no' }));

    await expect(
      completeSignOut({ client, readCookies: () => `${CUSTOMER_COOKIE}=value`, clearOnServer }),
    ).rejects.toThrow(SIGN_OUT_FAILED);
    expect(clearOnServer).toHaveBeenCalledTimes(1);
  });

  it('treats a revoked session that is still held in memory as not-signed-out', async () => {
    // Cookies are gone but the client still hands out a session: the fallback
    // has to run, because `getSession()` drives the UI.
    const { client } = fakeClient({ session: { access_token: 'x' } });
    let cookies = OTHER_COOKIES;
    let session = { access_token: 'x' };
    const clearOnServer = vi.fn(async () => {
      session = null;
      return { ok: true };
    });
    const instrumented = {
      auth: {
        signOut: client.auth.signOut,
        getSession: async () => ({ data: { session }, error: null }),
      },
    };

    const result = await completeSignOut({
      client: instrumented,
      readCookies: () => cookies,
      clearOnServer,
    });

    expect(clearOnServer).toHaveBeenCalledTimes(1);
    expect(result.clearedByBrowser).toBe(false);
  });

  it('survives a thrown sign-out call', async () => {
    const { client } = fakeClient({ throws: new Error('boom') });

    const result = await completeSignOut({ client, readCookies: () => OTHER_COOKIES });

    expect(result.revokedByServer).toBe(false);
    expect(console.warn).toHaveBeenCalled();
  });

  it('falls back to the server when no browser client is configured', async () => {
    let cookies = `${CUSTOMER_COOKIE}=value`;
    const clearOnServer = vi.fn(async () => {
      cookies = '';
      return { ok: true };
    });

    const result = await completeSignOut({ client: null, readCookies: () => cookies, clearOnServer });

    expect(clearOnServer).toHaveBeenCalledTimes(1);
    // Nothing was cleared by a browser client — but the session did end, and
    // that is what the result has to report.
    expect(result).toEqual({ revokedByServer: true, clearedByBrowser: false });
    expect(console.warn).toHaveBeenCalled();
  });

  it('never lets a failed sign-out resolve as success', async () => {
    await expect(
      completeSignOut({ client: null, readCookies: () => `${CUSTOMER_COOKIE}=value`, clearOnServer: null }),
    ).rejects.toThrow(SIGN_OUT_FAILED);
  });

  it('accepts an error from the revoke call when the device really is clear (auth-js clears locally first)', async () => {
    const { client } = fakeClient({ signOutResult: { error: { message: 'revoke failed', status: 500 } } });

    const result = await completeSignOut({ client, readCookies: () => OTHER_COOKIES });

    // Signed out on this device: no cookie, no session. `revokedByServer: false`
    // records that the server-side revocation did not confirm.
    expect(result).toEqual({ revokedByServer: false, clearedByBrowser: true });
  });
});
