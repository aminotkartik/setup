#!/usr/bin/env node
/**
 * Runs the exact SQL the app's read paths produce against the harness database
 * and reports `EXPLAIN ANALYZE` timing for each one.
 *
 * This is how index and RLS decisions are made: by looking at a real plan for a
 * real query shape, not by guessing which column "looks" slow.
 *
 *   node scripts/dev/perf/probe.mjs
 */

import pg from 'pg';
import { DATABASE_URL, banner } from './lib.mjs';
import { loadCatalog, buildSelect, buildRpc } from './sql.mjs';

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
const catalog = await loadCatalog(client);

const { rows: studentRows } = await client.query(
  `select pp.profile_id, pp.auth_user_id from public.profile_private pp
   join public.profiles p on p.id = pp.profile_id where p.username = 'aarav_p'`,
);
const student = studentRows[0];
const { rows: extras } = await client.query(`select id from public.conversations order by last_message_at desc limit 8`);

const cases = [
  ['communities by members (campus hub, clubs)', 'communities', new URLSearchParams({
    select: 'id, kind, name, slug, description, member_count',
    status: 'eq.published',
    kind: 'eq.club',
    order: 'member_count.desc,name.asc',
    limit: '3',
  })],
  ['notices list (noticeboard)', 'notices', new URLSearchParams({
    select: 'id, title, body, category, importance, pinned, expires_at, status, created_by, updated_by, published_at, created_at',
    status: 'eq.published',
    order: 'pinned.desc,published_at.desc',
    limit: '20',
    or: `(expires_at.is.null,expires_at.gte.${new Date().toISOString()})`,
  })],
  ['events list (home/campus)', 'events', new URLSearchParams({
    select: 'id, title, description, starts_on, start_time, location, is_official, organizer',
    status: 'eq.published',
    order: 'starts_on.asc',
    limit: '3',
    starts_on: `gte.${new Date().toISOString().slice(0, 10)}`,
  })],
  ['posts by ids (feed hydration)', 'posts', new URLSearchParams({
    select: 'id, author_id, kind, title, body, gif, community_id, visibility, status, is_official, pinned, comment_count, reaction_count, created_at',
    id: `in.(${(await client.query('select id from public.posts order by created_at desc limit 20')).rows.map((r) => r.id).join(',')})`,
  })],
  ['reactions for viewer (feed hydration)', 'reactions', new URLSearchParams({
    select: 'target_id',
    user_id: `eq.${student.profile_id}`,
    target_type: 'eq.post',
    target_id: `in.(${(await client.query('select id from public.posts order by created_at desc limit 20')).rows.map((r) => r.id).join(',')})`,
  })],
  ['marketplace listings (active)', 'marketplace_listings', new URLSearchParams({
    select: 'id, seller_id, title, description, price, is_free, condition, location, status, created_at',
    status: 'eq.active',
    order: 'created_at.desc',
    limit: '24',
  })],
  ['messages for a conversation', 'messages', new URLSearchParams({
    select: 'id, conversation_id, sender_id, body, gif, status, edited_at, deleted_at, created_at',
    conversation_id: `eq.${extras[0].id}`,
    order: 'created_at.desc',
    limit: '40',
  })],
  ['messages across the inbox window', 'messages', new URLSearchParams({
    select: 'id, conversation_id, sender_id, body, gif, status, edited_at, deleted_at, created_at',
    conversation_id: `in.(${extras.map((r) => r.id).join(',')})`,
    order: 'created_at.desc',
    limit: '240',
  })],
  ['notifications page', 'notifications', new URLSearchParams({
    select: 'id, type, title, body, url, reference_type, reference_id, read_at, created_at',
    order: 'created_at.desc',
    limit: '30',
    offset: '0',
  })],
  ['audit log page (admin)', 'audit_logs', new URLSearchParams({
    select: 'id, actor_user_id, action, target_type, target_id, metadata, visibility, created_at',
    order: 'created_at.desc',
    limit: '40',
  })],
  ['reports queue (admin)', 'reports', new URLSearchParams({
    select: 'id, reporter_id, target_type, target_id, reason, status, created_at',
    status: 'in.(pending,reviewing)',
    order: 'created_at.asc',
    limit: '50',
  })],
];

banner(`Query plans (as @aarav_p, RLS enforced)`);
for (const [label, table, params] of cases) {
  const { text, params: values } = buildSelect(catalog, table, params);
  const explained = text.replace(/^select \(select coalesce\(jsonb_agg\(r\)[\s\S]*?\) as data,\n?\s*\(select count/, 'select (select count');
  const started = Date.now();
  await runAs('authenticated', student.auth_user_id, `explain (analyze, buffers, format text) ${text}`, values);
  const elapsed = Date.now() - started;
  console.log(`\n\x1b[1m${label}\x1b[0m  (${elapsed}ms wall, incl. count query)`);
}

async function runAs(role, sub, sql, values) {
  await client.query('begin');
  await client.query(`set local role ${role}`);
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated' })]);
  await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub]);
  const { rows } = await client.query(sql, values);
  await client.query('rollback');
  for (const row of rows) console.log(row['QUERY PLAN'].split('\n').slice(0, 14).join('\n'));
}

await client.end();
