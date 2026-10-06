#!/usr/bin/env node
/**
 * `npm run role:grant` — the operator's role tool.
 *
 * Creates the very first Super Admin (a manual step in docs/DEPLOYMENT.md) and
 * changes roles afterwards. It uses the secret key because it is an operator
 * action, and it calls the same audited SQL functions the admin UI uses
 * (`grant_role` / `revoke_role`) — never a direct table write.
 *
 * Usage:
 *   node scripts/grant-role.mjs --email you@pccoepune.org --role super_admin
 *   node scripts/grant-role.mjs --username friend --role moderator
 *   node scripts/grant-role.mjs --list
 */

import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireValue, value, parseArgs, banner, ok, bad } from './lib/env.mjs';

const args = parseArgs();
const env = await loadEnv();
const url = requireValue(env, 'NEXT_PUBLIC_SUPABASE_URL');
const secret = requireValue(env, 'SUPABASE_SECRET_KEY', 'Run with SUPABASE_SECRET_KEY set, or add it to .env.local.');

const supabase = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const VALID_ROLES = ['student', 'moderator', 'admin', 'super_admin'];

banner('Campus+ roles');

if (args.list || (!args.email && !args.username && !args._.length)) {
  const { data: roles, error } = await supabase.from('roles').select('key,label,rank,is_staff').order('rank');
  if (error) {
    bad(error.message);
    process.exit(1);
  }
  for (const role of roles) {
    const { count } = await supabase
      .from('user_roles')
      .select('user_id', { count: 'exact', head: true })
      .eq('role_key', role.key);
    console.log(`  ${role.rank}. ${role.label.padEnd(14)} ${String(count ?? 0).padStart(4)} holder(s)  ${role.is_staff ? '(staff)' : ''}`);
  }
  console.log('\nGrant a role with: npm run role:grant -- --email you@pccoepune.org --role super_admin\n');
  process.exit(0);
}

const role = value(env, 'ROLE') || args.role || (args._.length === 2 ? args._[1] : null);
if (!role || !VALID_ROLES.includes(role)) {
  bad(`Pass --role with one of: ${VALID_ROLES.join(', ')}`);
  process.exit(1);
}

const email = args.email || args._[0] || null;
const username = args.username || null;
if (!email && !username) {
  bad('Pass --email <institutional email> or --username <username>.');
  process.exit(1);
}

// Resolve the target profile. The email lives in auth.users, so it needs the
// admin API; the username is resolved from the public projection.
let profileId = null;
if (username) {
  const { data } = await supabase.from('profiles').select('id,username').eq('username', username.toLowerCase()).maybeSingle();
  if (!data) {
    bad(`No profile with username "${username}".`);
    process.exit(1);
  }
  profileId = data.id;
} else {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) {
    bad(error.message);
    process.exit(1);
  }
  const authUser = data.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
  if (!authUser) {
    bad(`No account with email "${email}". The student must sign in once before you can grant a role.`);
    process.exit(1);
  }
  const { data: profile } = await supabase
    .from('profile_private')
    .select('profile_id,profiles ( id, username, display_name )')
    .eq('auth_user_id', authUser.id)
    .maybeSingle();
  if (!profile) {
    bad(`"${email}" has not finished onboarding yet (no profile).`);
    process.exit(1);
  }
  profileId = profile.profile_id;
  console.log(`  Account: ${profile.profiles?.display_name || '?'} (@${profile.profiles?.username || '?'})`);
}

const { data: before } = await supabase.from('user_roles').select('role_key').eq('user_id', profileId);
console.log(`  Current role(s): ${(before || []).map((r) => r.role_key).join(', ') || 'none'}`);

const { data, error } = await supabase.rpc('grant_role', { p_user: profileId, p_role: role });
if (error) {
  bad(error.message);
  process.exit(1);
}
ok(`Granted "${role}" (${JSON.stringify(data)}).`);
console.log('  The change is audited in audit_logs and the student is notified in-app.\n');
