#!/usr/bin/env node
/**
 * Functional smoke pass for the local performance build (development tool).
 *
 * Not a replacement for the real test suites — it proves that every signed-in
 * surface still renders the data it is supposed to render (feed, notices, admin
 * tables, marketplace, communities, DMs, notifications) and that the anonymous
 * gate still redirects and the retired Random surface still does not exist.
 * Run it against `serve.mjs` + a production
 * build the same way `measure.mjs` runs.
 *
 *   node scripts/dev/perf/smoke.mjs
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createSessionCookie } from './session.mjs';
import { DATABASE_URL } from './lib.mjs';
import pg from 'pg';

const cacheDir = path.join(process.cwd(), 'node_modules/.cache/perf');
const harness = JSON.parse(await readFile(path.join(cacheDir, 'harness.json'), 'utf8'));
const base = process.env.PERF_APP_URL || 'http://127.0.0.1:3100';

const studentCookie = (await createSessionCookie(harness.stubUrl, harness.student.email)).cookieHeader;
const adminCookie = (await createSessionCookie(harness.stubUrl, harness.admin.email)).cookieHeader;

let failures = 0;

/** A conversation the smoke-test student is not a member of (privacy probe). */
async function findForeignConversation() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(
      `select c.id
         from public.conversations c
        where not exists (
          select 1 from public.conversation_members m
           where m.conversation_id = c.id and m.user_id = $1
        )
        limit 1`,
      [harness.student.profileId],
    );
    return rows[0]?.id || null;
  } finally {
    await client.end();
  }
}

/**
 * A gig written by somebody else (so the detail page renders the applicant
 * view) and a published club, for the two section checks below.
 */
async function findSectionTargets() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const gig = await client.query(
      `select id from public.gigs
        where status = 'published' and state = 'open' and creator_id <> $1
        order by created_at desc limit 1`,
      [harness.student.profileId],
    );
    const club = await client.query(
      `select id from public.communities
        where kind = 'club' and status = 'published' order by created_at desc limit 1`,
    );
    return { gigId: gig.rows[0]?.id || null, clubId: club.rows[0]?.id || null };
  } finally {
    await client.end();
  }
}

async function check(label, href, { cookie, contains = [], missing = [], status = 200 } = {}) {
  const expected = Array.isArray(status) ? status : [status];
  const res = await fetch(`${base}${href}`, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
  const html = res.status === 200 ? await res.text() : '';
  const problems = [];
  if (!expected.includes(res.status)) problems.push(`status ${res.status} (expected ${expected.join(' or ')})`);
  for (const needle of contains) if (!html.includes(needle)) problems.push(`missing ${JSON.stringify(needle)}`);
  for (const needle of missing) if (html.includes(needle)) problems.push(`should not contain ${JSON.stringify(needle)}`);
  if (problems.length) failures += 1;
  console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${label.padEnd(26)} ${problems.join('; ')}`);
}

/**
 * A legacy address must send the browser to the new section. When the shell has
 * already streamed, Next cannot change the HTTP status: it returns 200 with a
 * `__next-page-redirect` meta tag and a NEXT_REDIRECT instruction in the RSC
 * payload. Both forms are accepted here; a real browser navigation is covered
 * by the Playwright pass.
 */
async function checkRedirect(label, href, { cookie, to }) {
  const res = await fetch(`${base}${href}`, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
  const html = res.status === 200 ? await res.text() : '';
  const location = res.headers.get('location') || '';
  const problems = [];
  if (!((res.status >= 300 && res.status < 400 && location.endsWith(to))
    || html.includes(`url=${to}"`)
    || html.includes(`NEXT_REDIRECT;replace;${to};`))) {
    problems.push(`no redirect to ${to} (status ${res.status})`);
  }
  if (problems.length) failures += 1;
  console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${label.padEnd(26)} ${problems.join('; ')}`);
}

// The auth gate first: no cookie, no app.
await check('gate: /home anonymous', '/home', { status: 307, missing: ['<main'] });

await check('home', '/home', {
  cookie: studentCookie,
  contains: ['Campus update', 'Events ahead', 'aria-label="Post"'],
});
await check('campus hub', '/campus', { cookie: studentCookie, contains: ['Latest official notices', 'clubs'] });
await check('noticeboard', '/campus/noticeboard', { cookie: studentCookie, contains: ['Noticeboard'] });
await check('explore', '/explore', { cookie: studentCookie, contains: ['Trending now', 'Communities'] });
await check('communities', '/communities', { cookie: studentCookie, contains: ['/communities/'] });
await check('marketplace', '/market', { cookie: studentCookie, contains: ['/market/listing/'], missing: ['?tab=gigs'] });

const { gigId, clubId } = await findSectionTargets();
await check('gigs board', '/gigs', { cookie: studentCookie, contains: ['Post a Gig', 'Gig: poster design'] });
if (gigId) {
  await check('gig detail', `/gigs/${gigId}`, { cookie: studentCookie, contains: ['Who is offering this', 'Apply for this gig'] });
  await checkRedirect('legacy gig redirect', `/market/gigs/${gigId}`, {
    cookie: studentCookie,
    to: `/gigs/${gigId}`,
  });
} else {
  console.log('note  no open gig by another author to probe');
}
await check('clubs board', '/clubs', { cookie: studentCookie, contains: ['Clubs', 'Coding Club', 'Technical'] });
if (clubId) {
  await check('club detail', `/clubs/${clubId}`, { cookie: studentCookie, contains: ['Announcements', 'Members', 'Upcoming events'] });
} else {
  console.log('note  no published club to probe');
}
await checkRedirect('legacy clubs redirect', '/campus/clubs', {
  cookie: studentCookie,
  to: '/clubs',
});
await check('notifications', '/notifications', { cookie: studentCookie, contains: ['Notifications'] });
await check('chat list', '/chat', { cookie: studentCookie, contains: ['/chat/'] });
await check('chat thread', `/chat/${harness.conversationId}`, { cookie: studentCookie, contains: ['Send'] });
await check('profile', '/profile', { cookie: studentCookie, contains: ['aria-label="Post"'] });
await check('settings', '/settings', { cookie: studentCookie, contains: ['Settings', 'Sign out'] });
await check('public profile', `/user/${harness.student.username}`, { cookie: studentCookie, contains: ['aria-label="Post"'] });
await check('post detail', `/post/${harness.postId}`, { cookie: studentCookie, contains: ['Comments'] });
// Random chat is retired: there is no student route, no navigation entry and no
// session url. This asserts the retirement instead of expecting a page.
await check('random stays retired', '/random', { cookie: studentCookie, status: 404 });

await check('admin: counts tab', '/admin?tab=counts', { cookie: adminCookie, contains: ['Operational counts'] });
await check('admin: users tab', '/admin?tab=users', { cookie: adminCookie, contains: [harness.student.username] });
await check('admin: reports tab', '/admin?tab=reports', { cookie: adminCookie, contains: ['Reports'] });
await check('moderation', '/moderator', { cookie: adminCookie, contains: ['Moderation'] });

// A student must not see the admin console.
await check('admin gate (student)', '/admin', { cookie: studentCookie, missing: ['Operational counts'] });
// A student must not be able to open a thread they are not part of, even with
// its id — the same rule the SQL suite asserts directly.
const strangerThread = await findForeignConversation();
if (strangerThread) {
  await check('dm privacy (foreign thread)', `/chat/${strangerThread}`, { cookie: studentCookie, status: 404 });
} else {
  console.log('note  no foreign conversation to probe (single-pair fixture)');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall smoke checks passed');
process.exit(failures ? 1 : 0);
