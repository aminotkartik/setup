#!/usr/bin/env node
/**
 * Mints a real `@supabase/ssr` session cookie against the harness stub.
 *
 * The production sign-in path is Google OAuth, which cannot run in a sandbox.
 * Everything *after* the OAuth callback is unchanged, so the harness bootstraps
 * a session the same way the library would store it: by asking
 * `createServerClient` to sign in and letting it write its own cookies.
 */

import { createServerClient } from '@supabase/ssr';
import { PUBLISHABLE_KEY } from './lib.mjs';
import { PASSWORD } from './seed.mjs';

export async function createSessionCookie(stubUrl, email) {
  const jar = [];
  const supabase = createServerClient(stubUrl, PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => jar.map(({ name, value }) => ({ name, value })),
      setAll: (cookies) => {
        for (const cookie of cookies) {
          const index = jar.findIndex((entry) => entry.name === cookie.name);
          if (index === -1) jar.push({ name: cookie.name, value: cookie.value });
          else jar[index] = { name: cookie.name, value: cookie.value };
        }
      },
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Harness sign-in failed: ${error.message}`);
  return {
    cookieHeader: jar.map(({ name, value }) => `${name}=${value}`).join('; '),
    userId: data.user?.id,
    cookies: jar,
  };
}
