#!/usr/bin/env node
/**
 * Preview harness for the sandbox (development tool).
 *
 * The classroom preview browses the sandbox from another machine, which needs
 * two things a plain `next start` cannot give it:
 *
 *   1. a session. Sign-in is Google OAuth with the `@pccoepune.org` rule, so a
 *      preview browser cannot sign in by itself. This proxy mints a harness
 *      session (the same real `@supabase/ssr` cookie the app would write) and
 *      hands it to the browser, so the preview opens straight onto the signed-in
 *      application — Home and every other authenticated screen.
 *   2. a frameable response. Production adds `X-Frame-Options: DENY`; the
 *      preview renders inside the classroom's iframe, so this proxy strips the
 *      framing guard on the way out. It is a local tool: it never runs where
 *      real users are served.
 *
 * Nothing else is touched: requests, bodies, redirects, `Set-Cookie` and
 * streaming responses pass through untouched.
 *
 *   node scripts/dev/preview.mjs [--port 3300] [--app http://127.0.0.1:3100] [--email perf.student1@pccoepune.org]
 *
 * Requires `npm run perf:serve` (Postgres + Supabase stub) and a production build
 * running on APP_URL.
 */

import http from 'node:http';
import { parseArgs } from 'node:util';
import { createSessionCookie } from './perf/session.mjs';

const { values } = parseArgs({
  options: { port: { type: 'string' }, app: { type: 'string' }, email: { type: 'string' }, stub: { type: 'string' } },
  allowPositionals: true,
});

const PORT = Number(values.port || process.env.PREVIEW_PORT || 3300);
const APP = new URL(values.app || process.env.APP_URL || 'http://127.0.0.1:3100');
const STUB = values.stub || process.env.STUB_URL || 'http://127.0.0.1:3111';
const EMAIL = values.email || process.env.PERF_EMAIL || 'perf.student1@pccoepune.org';

const session = await createSessionCookie(STUB, EMAIL);
const sessionCookies = session.cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
const sessionCookieNames = session.cookies.map(({ name }) => name);
// Max-Age matches `@supabase/ssr`'s own default (400 days) so the preview keeps
// its session for as long as the harness does.
const sessionSetCookie = session.cookies.map(
  ({ name, value }) => `${name}=${value}; Path=/; SameSite=Lax; Max-Age=${400 * 24 * 60 * 60}`,
);

/** Does this request already carry a Supabase session of its own? */
function hasSession(req) {
  const cookie = req.headers.cookie || '';
  return sessionCookieNames.some((name) => new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=`).test(cookie));
}

const server = http.createServer((req, res) => {
  const signedIn = hasSession(req);
  const headers = { ...req.headers, host: APP.host };
  if (signedIn) headers.cookie = req.headers.cookie;
  else headers.cookie = [req.headers.cookie, sessionCookies].filter(Boolean).join('; ');

  const upstream = http.request(
    {
      protocol: APP.protocol,
      hostname: APP.hostname,
      port: APP.port,
      method: req.method,
      path: req.url,
      headers,
    },
    (upstreamResponse) => {
      const out = { ...upstreamResponse.headers };
      // The preview is framed by the classroom shell; the clickjacking guard is
      // deliberately removed here and nowhere else.
      delete out['x-frame-options'];
      if (out['content-security-policy']) {
        out['content-security-policy'] = out['content-security-policy']
          .split(';')
          .filter((directive) => !directive.trim().toLowerCase().startsWith('frame-ancestors'))
          .join(';');
      }
      // Give the browser its own copy of the session, so client components read
      // exactly the session the server does.
      const setCookie = upstreamResponse.headers['set-cookie'] || [];
      out['set-cookie'] = signedIn ? setCookie : [...setCookie, ...sessionSetCookie];

      res.writeHead(upstreamResponse.statusCode || 502, out);
      upstreamResponse.pipe(res);
    },
  );

  upstream.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Preview proxy could not reach ${APP.origin}: ${error.message}`);
  });

  req.pipe(upstream);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Campus+ preview: http://0.0.0.0:${PORT} → ${APP.origin}`);
  console.log(`  signed in as ${EMAIL} (harness session, no Google round trip)`);
  console.log('  sessions are re-injected on every request, so the preview cannot be signed out of');
});
