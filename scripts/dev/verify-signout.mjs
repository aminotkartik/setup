#!/usr/bin/env node
/**
 * Sign-out verification against the running app (development tool).
 *
 * `tests/signout.test.js` proves the sign-out *logic* with fake clients. This
 * proves the whole path on a real device: the real `@supabase/ssr` browser
 * client, the real app modules, a real session minted by the harness Supabase
 * stub, and the real Next server answering for it.
 *
 * What it does, in order:
 *
 *   1. Mints a genuine session through `scripts/dev/perf/session.mjs` — the
 *      library writes its own cookies, exactly as the OAuth callback would.
 *   2. Gives Node a faithful `document.cookie` (host-only names, `Path`,
 *      `Max-Age`/`Expires`, delete-on-expiry — a browser's rules, not a Map).
 *   3. Bundles the *real* `lib/supabase/client.js`, `lib/auth/client-actions.js`
 *      (performSignOut + useSignOut) and `lib/auth/sign-out.js` with esbuild,
 *      inlining `NEXT_PUBLIC_SUPABASE_*` the way the production build does.
 *   4. Drives `useSignOut()` the way the button does — twice in one tick, to
 *      prove the second click cannot fire a second sign-out.
 *   5. Asserts the device is signed out: no `sb-*-auth-token` cookie left, no
 *      session from `getSession()`, exactly one `POST /auth/v1/logout` on the
 *      wire, navigation to `/login` followed by a router refresh.
 *   6. Asserts the server agrees: `/home` without the cookie answers 307 to
 *      `/login?next=%2Fhome`, `/login` answers 200 and never bounces back —
 *      while a *copy* of the cookie (the state a browser that kept the cookie
 *      would be in) still opens `/home`, which is the symptom the fix removes.
 *   7. Drives the failure path and asserts it stays honest: the error thrown is
 *      the student-facing message, nothing navigates as if it had worked, and no
 *      cookie value, token or secret appears in the thrown message or in what
 *      was logged.
 *
 * Requirements: `npm run perf:serve` (Postgres + stub) and a production build
 * served on APP_URL (default http://127.0.0.1:3100) with the harness env inline.
 *
 *   node scripts/dev/verify-signout.mjs [--app http://127.0.0.1:3100] [--email perf.student1@pccoepune.org]
 *
 * Exit code 0 = every check passed. Nothing here prints a token or a cookie.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import esbuild from 'esbuild';
import { createSessionCookie } from './perf/session.mjs';

const { values } = parseArgs({
  options: { app: { type: 'string' }, email: { type: 'string' }, stub: { type: 'string' } },
  allowPositionals: true,
});

const ROOT = process.cwd();
const APP_URL = (values.app || process.env.APP_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
const STUB_URL = (values.stub || process.env.STUB_URL || 'http://127.0.0.1:3111').replace(/\/$/, '');
const EMAIL = values.email || process.env.PERF_EMAIL || 'perf.student1@pccoepune.org';
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'signout');

const results = [];
function check(label, ok, detail = '') {
  results.push({ label, ok: Boolean(ok), detail });
  const mark = ok ? '\u001b[32mok\u001b[39m' : '\u001b[31mFAIL\u001b[39m';
  console.log(`  ${mark}  ${label}${detail ? ` — ${detail}` : ''}`);
}

/* -------------------------------------------------------------------------- */
/* A document.cookie with a browser's rules                                    */
/* -------------------------------------------------------------------------- */

function createCookieJar() {
  /** key "name;domain;path" -> { name, value, expires } */
  const entries = new Map();
  const key = (name, domain, cookiePath) => `${name};${domain};${cookiePath}`;

  return {
    write(raw) {
      const [pair, ...attrs] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq === -1) return;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name) return;
      let cookiePath = '/';
      let domain = '';
      let expires = null;
      for (const attr of attrs) {
        const [rawKey, ...rest] = attr.split('=');
        const attrName = rawKey.trim().toLowerCase();
        const attrValue = rest.join('=').trim();
        if (attrName === 'path') cookiePath = attrValue || '/';
        else if (attrName === 'domain') domain = attrValue.replace(/^\./, '');
        else if (attrName === 'max-age') {
          const seconds = Number(attrValue);
          if (!Number.isNaN(seconds)) expires = seconds <= 0 ? 0 : Date.now() + seconds * 1000;
        } else if (attrName === 'expires') {
          const parsed = Date.parse(attrValue);
          if (!Number.isNaN(parsed)) expires = parsed;
        }
      }
      // A deletion removes exactly the (name, domain, path) it names. A cookie
      // written at another scope is untouched — the trap this tool exists to
      // notice.
      const entryKey = key(name, domain, cookiePath);
      if (expires !== null && expires <= Date.now()) entries.delete(entryKey);
      else entries.set(entryKey, { name, value, domain, expires });
    },
    read() {
      return [...entries.values()].map(({ name, value }) => `${name}=${value}`).join('; ');
    },
    names() {
      return [...entries.values()].map(({ name }) => name);
    },
    count() {
      return entries.size;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Browser environment                                                         */
/* -------------------------------------------------------------------------- */

function installBrowserEnvironment(jar) {
  const storage = () => {
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(String(k), String(v)),
      removeItem: (k) => map.delete(k),
      clear: () => map.clear(),
      key: (i) => [...map.keys()][i] ?? null,
      get length() {
        return map.size;
      },
    };
  };

  // Node already owns some of these names as getter-only globals (navigator on
  // Node 22), so every install goes through a defineProperty that can replace
  // them without disturbing anything else.
  const define = (name, value) => {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  };

  define('window', globalThis);
  define('document', {
    get cookie() {
      return jar.read();
    },
    set cookie(value) {
      jar.write(value);
    },
    addEventListener() {},
    removeEventListener() {},
  });
  // `navigator` stays Node's own object: it has no `locks`, which is exactly
  // the situation a browser without the Web Locks API is in.
  define('location', new URL(`${APP_URL}/home`));
  define('localStorage', storage());
  define('sessionStorage', storage());
}

/* -------------------------------------------------------------------------- */
/* Bundle the real modules                                                     */
/* -------------------------------------------------------------------------- */

async function loadAppModules({ stubServerAction, outfileName = 'browser.mjs' }) {
  mkdirSync(CACHE, { recursive: true });

  const reactStub = path.join(CACHE, 'react.stub.mjs');
  const navigationStub = path.join(CACHE, 'next-navigation.stub.mjs');
  const authActionStub = path.join(CACHE, 'auth-action.stub.mjs');
  const entry = path.join(CACHE, `entry-${outfileName}`);
  const outfile = path.join(CACHE, outfileName);

  // React without a renderer: `useSignOut` only needs a stable ref and a couple
  // of state slots, and the probe drives it exactly once per call.
  writeFileSync(
    reactStub,
    `const slots = [];
export const __state = slots;
export function useState(initial) {
  const index = slots.length;
  slots.push({ value: initial });
  const set = (next) => {
    slots[index].value = typeof next === 'function' ? next(slots[index].value) : next;
  };
  return [slots[index].value, set];
}
export function useRef(initial) { return { current: initial }; }
export function useCallback(fn) { return fn; }
export function useMemo(fn) { return fn(); }
export function useEffect() {}
export function useLayoutEffect() {}
export default { useState, useRef, useCallback, useMemo, useEffect, useLayoutEffect };
`,
  );

  writeFileSync(
    navigationStub,
    `export function useRouter() {
  globalThis.__navigation = globalThis.__navigation || [];
  return {
    replace: (href) => globalThis.__navigation.push({ method: 'replace', href }),
    push: (href) => globalThis.__navigation.push({ method: 'push', href }),
    refresh: () => globalThis.__navigation.push({ method: 'refresh' }),
    prefetch: () => {},
    back: () => globalThis.__navigation.push({ method: 'back' }),
  };
}
export function usePathname() { return '/home'; }
export function useSearchParams() { return new URLSearchParams(); }
`,
  );

  // The Server Action cannot run outside a request scope, so it is replaced by
  // a counter: the happy path must never need it, and the failure path uses it
  // to prove the fallback is attempted before the error is raised.
  writeFileSync(
    authActionStub,
    `export async function endSession() {
  globalThis.__serverFallbackCalls = (globalThis.__serverFallbackCalls || 0) + 1;
  return globalThis.__serverFallbackResult || { ok: true };
}
export async function startGoogleSignIn() { throw new Error('not available in the probe'); }
export async function completeOnboarding() { throw new Error('not available in the probe'); }
`,
  );
  if (stubServerAction) globalThis.__serverFallbackResult = stubServerAction;

  writeFileSync(
    entry,
    `export { getBrowserClient, isBrowserConfigured } from '@/lib/supabase/client';
export { performSignOut, useSignOut } from '@/lib/auth/client-actions';
export { completeSignOut, SIGN_OUT_FAILED } from '@/lib/auth/sign-out';
export { supabaseAuthCookieNames } from '@/lib/auth/cookies';
`,
  );

  const exact = {
    react: reactStub,
    'next/navigation': navigationStub,
    '@/lib/actions/auth': authActionStub,
  };

  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent',
    define: {
      'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(STUB_URL),
      'process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('sb_publishable_perf_harness_key'),
    },
    plugins: [
      {
        name: 'campus-aliases',
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (exact[args.path]) return { path: exact[args.path] };
            if (args.path.startsWith('@/')) {
              const base = path.join(ROOT, args.path.slice(2));
              for (const suffix of ['', '.js', '.mjs', '/index.js']) {
                if (existsSync(base + suffix)) return { path: base + suffix };
              }
              return { path: base };
            }
            return null;
          });
        },
      },
    ],
  });

  return import(outfile);
}

/* -------------------------------------------------------------------------- */
/* HTTP                                                                        */
/* -------------------------------------------------------------------------- */

async function request(url, cookieHeader) {
  const response = await fetch(url, {
    redirect: 'manual',
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
  return { status: response.status, location: response.headers.get('location') };
}

/* -------------------------------------------------------------------------- */

async function main() {
  console.log(`\nCampus+ sign-out verification — app ${APP_URL}, stub ${STUB_URL}, ${EMAIL}\n`);

  /* 0 — the build must actually carry the public configuration. */
  const chunkUrls = [];
  const chunksDir = path.join(ROOT, '.next', 'static', 'chunks');
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js') && readFileSync(full, 'utf8').includes(STUB_URL)) chunkUrls.push(full);
    }
  };
  if (existsSync(chunksDir)) walk(chunksDir);
  check(
    'the Supabase URL is inlined in the built client bundle',
    chunkUrls.length > 0,
    `${chunkUrls.length} chunk(s)`,
  );

  const { cookieHeader, cookies, userId } = await createSessionCookie(STUB_URL, EMAIL);
  check('harness minted a session cookie', cookies.length > 0 && cookieHeader.includes('auth-token'), `${cookies.length} cookie(s)`);
  const sessionCookieValue = cookies.find(({ name }) => /-auth-token(\.\d+)?$/.test(name))?.value || '';

  /* 1 — a browser holding that session. */
  const jar = createCookieJar();
  installBrowserEnvironment(jar);
  for (const { name, value } of cookies) jar.write(`${name}=${value}; Path=/`);

  const leaked = new Set();
  const realWarn = console.warn;
  console.warn = (...args) => {
    for (const arg of args) if (String(arg).includes(sessionCookieValue) && sessionCookieValue) leaked.add('console');
    realWarn(...args);
  };

  const navigation = (globalThis.__navigation = []);
  const wire = [];
  const realFetch = globalThis.fetch;
  let logoutPosts = 0;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init?.method || 'GET').toUpperCase();
    wire.push({ method, url });
    if (method === 'POST' && url.includes('/auth/v1/logout')) logoutPosts += 1;
    return realFetch(input, init);
  };

  const mod = await loadAppModules({});

  check('this browser is configured (the original bug: it was not)', mod.isBrowserConfigured() === true);

  const client = mod.getBrowserClient();
  check('the browser client exists', Boolean(client));

  const before = await client.auth.getSession();
  check('the browser client sees the server-written session', Boolean(before.data?.session?.access_token));

  const signedIn = await request(`${APP_URL}/home`, cookieHeader);
  check('the session cookie opens /home (200)', signedIn.status === 200, `status ${signedIn.status}`);

  const bouncedLogin = await request(`${APP_URL}/login`, cookieHeader);
  check(
    'while it is signed in, /login bounces to /home — the symptom',
    bouncedLogin.status === 307 && (bouncedLogin.location || '').includes('/home'),
    `${bouncedLogin.status} ${bouncedLogin.location || ''}`,
  );

  /* 2 — the click path. */
  const hookState = [];
  const { signOut } = (() => {
    const api = mod.useSignOut();
    hookState.push(api);
    return api;
  })();

  const first = signOut();
  const second = signOut(); // same tick: must be swallowed by the in-flight ref
  await Promise.allSettled([first, second]);

  check('exactly one sign-out request reached the auth server', logoutPosts === 1, `${logoutPosts} POST /auth/v1/logout`);
  check('no Supabase session cookie survives on the device', mod.supabaseAuthCookieNames(jar.read()).length === 0, `${jar.count()} cookie(s) left`);
  check('the jar is empty of auth cookies', mod.supabaseAuthCookieNames(document.cookie).length === 0);

  const afterSession = await client.auth.getSession();
  check('getSession() reports no session', !afterSession.data?.session);

  const replace = navigation.find((entry) => entry.method === 'replace');
  check('sign-out navigates to /login', replace?.href === '/login', replace?.href || 'no navigation');
  check('the server-rendered tree is refreshed', navigation.some((entry) => entry.method === 'refresh'));

  const afterHome = await request(`${APP_URL}/home`, jar.read());
  check(
    '/home now redirects to /login with the next path',
    afterHome.status === 307 && decodeURIComponent(afterHome.location || '').includes('/login?next=/home'),
    `${afterHome.status} ${afterHome.location || ''}`,
  );
  const afterLogin = await request(`${APP_URL}/login`, jar.read());
  check('/login now renders instead of bouncing back', afterLogin.status === 200, `status ${afterLogin.status}`);

  const protectedUrls = ['/home', '/settings', '/notifications', '/market', '/chat', '/explore'];
  const stillOpen = [];
  for (const url of protectedUrls) {
    const response = await request(`${APP_URL}${url}`, jar.read());
    if (response.status !== 307 || !decodeURIComponent(response.location || '').startsWith('/login')) {
      stillOpen.push(`${url} → ${response.status}`);
    }
  }
  check(
    'every protected screen redirects to /login after sign-out',
    stillOpen.length === 0,
    stillOpen.length ? stillOpen.join(', ') : protectedUrls.join(', '),
  );

  /* 2b — a large session arrives as several cookies. The whole device must be
        signed out of a chunked session too, not just the single-cookie case. */
  const baseName = cookies[0].name;
  const baseValue = cookies[0].value;
  const half = Math.ceil(baseValue.length / 2);
  const chunked = [
    { name: `${baseName}.0`, value: baseValue.slice(0, half) },
    { name: `${baseName}.1`, value: baseValue.slice(half) },
  ];
  const chunkedJar = createCookieJar();
  installBrowserEnvironment(chunkedJar);
  for (const { name, value } of chunked) chunkedJar.write(`${name}=${value}; Path=/`);
  const chunkedHeader = chunked.map(({ name, value }) => `${name}=${value}`).join('; ');
  const chunkedNavigation = (globalThis.__navigation = []);

  const chunkedMod = await loadAppModules({ outfileName: 'browser-chunked.mjs' });
  const chunkedClient = chunkedMod.getBrowserClient();
  const chunkedBefore = await chunkedClient.auth.getSession();
  check('a chunked session is recognised as signed in', Boolean(chunkedBefore.data?.session?.access_token));
  const chunkedHome = await request(`${APP_URL}/home`, chunkedHeader);
  check('the server accepts a chunked session', chunkedHome.status === 200, `status ${chunkedHome.status}`);

  await chunkedMod.useSignOut().signOut();
  check('a chunked session leaves no cookie behind', chunkedMod.supabaseAuthCookieNames(chunkedJar.read()).length === 0);
  check('the chunked sign-out navigates to /login', chunkedNavigation.some((entry) => entry.method === 'replace' && entry.href === '/login'));
  const chunkedAfter = await request(`${APP_URL}/home`, chunkedJar.read());
  check('the chunked device is signed out on the server', chunkedAfter.status === 307, `status ${chunkedAfter.status}`);

  /* 3 — the failure path stays honest. */
  const fallbackCallsBefore = globalThis.__serverFallbackCalls || 0;
  globalThis.__serverFallbackResult = { ok: false, error: 'simulated' };
  const stuckJar = createCookieJar();
  for (const { name, value } of cookies) stuckJar.write(`${name}=${value}; Path=/`);
  const stuckNavigation = [];
  const stuck = {
    auth: {
      async signOut() {
        throw new Error('network unreachable');
      },
      async getSession() {
        return { data: { session: { access_token: 'never printed', user: { id: userId } } } };
      },
    },
  };
  globalThis.__navigation = stuckNavigation;

  let thrown = null;
  try {
    await mod.completeSignOut({
      client: stuck,
      readCookies: () => stuckJar.read(),
      clearOnServer: async () => {
        globalThis.__serverFallbackCalls = (globalThis.__serverFallbackCalls || 0) + 1;
        return { ok: false, error: 'simulated' };
      },
    });
  } catch (error) {
    thrown = error;
  }

  check('a sign-out that cannot finish throws instead of reporting success', Boolean(thrown));
  check(
    'the thrown message is the student-facing one',
    /could not sign you out/i.test(thrown?.message || ''),
    JSON.stringify(thrown?.message || '').slice(0, 90),
  );
  check('the server fallback was attempted first', (globalThis.__serverFallbackCalls || 0) > fallbackCallsBefore);
  check('nothing navigated as if sign-out had worked', stuckNavigation.length === 0);
  check('the session cookie was left intact in that scenario (the point)', mod.supabaseAuthCookieNames(stuckJar.read()).length > 0);
  check('the thrown message carries no cookie value', !sessionCookieValue || !(thrown?.message || '').includes(sessionCookieValue));
  check('no cookie value or token was logged', leaked.size === 0, `${leaked.size} leak(s)`);
  console.warn = realWarn;

  /* ------------------------------------------------------------------ */
  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n  ${results.length - failed.length}/${results.length} checks passed\n`);
  check('overall', failed.length === 0, failed.length ? `failed: ${failed.map((entry) => entry.label).join('; ')}` : 'PASS');

  try {
    client.auth.stopAutoRefresh?.();
  } catch {
    /* nothing to stop */
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nverify-signout failed to run: ${error?.message || error}\n`);
  process.exit(1);
});
