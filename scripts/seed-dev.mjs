#!/usr/bin/env node
/**
 * `npm run seed:dev` — DEVELOPMENT-ONLY sample content.
 *
 * This script is deliberately awkward to run: it needs `--confirm`, refuses to
 * work against a production deployment, and marks every fixture with the
 * `dev_` username prefix and @example.invalid contact rows. It exists so a
 * fresh local database has something to look at; it is never part of a
 * deployment (spec §12 — seed data must be clearly dev-only, and the empty
 * states in the UI are the real first-run experience).
 *
 * Usage:
 *   node scripts/seed-dev.mjs --confirm
 */

import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireValue, parseArgs, banner, ok, bad, warn } from './lib/env.mjs';

const args = parseArgs();
const env = await loadEnv();
const url = requireValue(env, 'NEXT_PUBLIC_SUPABASE_URL');
const secret = requireValue(env, 'SUPABASE_SECRET_KEY');

if (!args.confirm) {
  bad('Refusing to seed without --confirm.');
  console.log('  This writes sample rows into the project at ' + url + '.');
  console.log('  Run: node scripts/seed-dev.mjs --confirm\n');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
  bad('Refusing to run the development seeder in a production environment.');
  process.exit(1);
}

const supabase = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

const DOMAIN = (env.CAMPUS_ALLOWED_EMAIL_DOMAINS || 'pccoepune.org').split(',')[0].trim();
const DEV_USERS = [
  { local: 'dev_arjun', name: 'Arjun (dev seed)', email: `dev.arjun@${DOMAIN}` },
  { local: 'dev_meera', name: 'Meera (dev seed)', email: `dev.meera@${DOMAIN}` },
  { local: 'dev_kabir', name: 'Kabir (dev seed)', email: `dev.kabir@${DOMAIN}` },
];

banner('Campus+ development seed');

// 1. Accounts. Sign-in is Google OAuth, so the seeder creates confirmed
// accounts through the admin API; the provisioning trigger builds the profile.
// (Seeded addresses are fixtures and do not belong to real Google accounts —
// use them as data, not as a way to sign in.)
const ids = {};
for (const user of DEV_USERS) {
  const { data: existing } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  let authUser = existing.users.find((u) => (u.email || '').toLowerCase() === user.email);
  if (!authUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: user.email,
      email_confirm: true,
      user_metadata: { seeded: true },
    });
    if (error) {
      bad(`${user.email}: ${error.message}`);
      process.exit(1);
    }
    authUser = data.user;
  }
  const { data: link } = await supabase
    .from('profile_private')
    .select('profile_id')
    .eq('auth_user_id', authUser.id)
    .maybeSingle();
  if (!link?.profile_id) {
    warn(`${user.email}: no profile yet — the provisioning trigger runs on signup only. Skipped.`);
    continue;
  }
  ids[user.local] = link.profile_id;
  const { data: profile } = await supabase.from('profiles').select('username').eq('id', link.profile_id).maybeSingle();
  if (profile?.username !== user.local) {
    // Finish onboarding with the dev username (unless the account already has one).
    if (!profile) {
      await supabase.rpc('complete_profile', {
        p_username: user.local,
        p_display_name: user.name,
        p_branch: 'Computer Engineering',
        p_year: 'Third Year',
      });
    }
  }
  ok(`account ready: @${user.local}`);
}

const [arjun, meera, kabir] = [ids.dev_arjun, ids.dev_meera, ids.dev_kabir];
if (!arjun || !meera) {
  bad('The dev accounts could not be resolved; aborting before writing content.');
  process.exit(1);
}

// 2. Content. Each row is marked dev-only either through the author or through
// an explicit "(dev seed)" prefix so nobody mistakes it for real content.
const posts = [
  { author_id: arjun, body: '(dev seed) Reminder: the library is closed on Sunday for stocktaking.' },
  { author_id: meera, body: '(dev seed) Anyone free to study DBMS unit 3 on Thursday evening?' },
  { author_id: kabir, body: '(dev seed) Found a blue water bottle near the canteen. DM me if it is yours.' },
];
const { error: postsError } = await supabase.from('posts').insert(posts);
if (postsError) warn(`posts: ${postsError.message}`);
else ok(`inserted ${posts.length} dev posts`);

const { data: community, error: communityError } = await supabase
  .from('communities')
  .insert({
    name: '(dev seed) DBMS study group',
    slug: 'dev-dbms-study-group',
    description: 'Sample community created by scripts/seed-dev.mjs.',
    kind: 'study_group',
    owner_id: meera,
  })
  .select('id')
  .maybeSingle();
if (communityError) warn(`community: ${communityError.message}`);
else ok('inserted one dev study group');
if (community?.id) {
  await supabase.from('community_members').insert({ community_id: community.id, user_id: arjun, role: 'member' });
}

const { data: category } = await supabase.from('marketplace_categories').select('id').eq('is_active', true).limit(1).maybeSingle();
if (category?.id) {
  const { error } = await supabase.from('marketplace_listings').insert({
    seller_id: meera,
    category_id: category.id,
    title: '(dev seed) Engineering graphics kit',
    description: 'Sample listing created by scripts/seed-dev.mjs. Safe to delete.',
    price: 350,
    condition: 'good',
    status: 'active',
    contact_note: 'dev seed only — no real contact details',
  });
  if (error) warn(`listing: ${error.message}`);
  else ok('inserted one dev listing');
} else {
  warn('no marketplace categories found — run the migrations first');
}

console.log('\nDevelopment seed complete. All rows are prefixed "(dev seed)".\n');
