#!/usr/bin/env node
/**
 * Functional smoke pass for the local performance build (development tool).
 *
 * Not a replacement for the real test suites — it proves that every signed-in
 * surface still renders the data it is supposed to render (feed, notices, admin
 * tables, marketplace, communities, DMs, random, notifications) and that the
 * anonymous gate still redirects. Run it against `serve.mjs` + a production
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

async function check(label, href, { cookie, contains = [], missing = [], status = 200 } = {}) {
  const res = await fetch(`${base}${href}`, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
  const html = res.status === status && res.status === 200 ? await res.text() : '';
  const problems = [];
  if (res.status !== status) problems.push(`status ${res.status} (expected ${status})`);
  for (const needle of contains) if (!html.includes(needle)) problems.push(`missing ${JSON.stringify(needle)}`);
  for (const needle of missing) if (html.includes(needle)) problems.push(`should not contain ${JSON.stringify(needle)}`);
  if (problems.length) failures += 1;
  console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${label.padEnd(26)} ${problems.join('; ')}`);
}

// The auth gate first: no cookie, no app.
await check('gate: /home anonymous', '/home', { status: 307, missing: ['<main'] });

await check('home', '/home', {
  cookie: studentCookie,
  contains: ['Campus update', 'Upcoming events', 'aria-label="Post"'],
});
await check('campus hub', '/campus', { cookie: studentCookie, contains: ['Latest official notices', 'clubs'] });
await check('noticeboard', '/campus/noticeboard', { cookie: studentCookie, contains: ['Noticeboard'] });
await check('explore', '/explore', { cookie: studentCookie, contains: ['Trending now', 'Communities'] });
await check('communities', '/communities', { cookie: studentCookie, contains: ['/communities/'] });
await check('marketplace', '/market', { cookie: studentCookie, contains: ['/market/listing/', '/market?tab=gigs'] });
await check('notifications', '/notifications', { cookie: studentCookie, contains: ['Notifications'] });
await check('chat list', '/chat', { cookie: studentCookie, contains: ['/chat/'] });
await check('chat thread', `/chat/${harness.conversationId}`, { cookie: studentCookie, contains: ['Send'] });
await check('profile', '/profile', { cookie: studentCookie, contains: ['aria-label="Post"'] });
await check('settings', '/settings', { cookie: studentCookie, contains: ['Settings', 'Sign out'] });
await check('public profile', `/user/${harness.student.username}`, { cookie: studentCookie, contains: ['aria-label="Post"'] });
await check('post detail', `/post/${harness.postId}`, { cookie: studentCookie, contains: ['Comments'] });
await check('random', '/random', { cookie: studentCookie, contains: ['Random'] });

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
