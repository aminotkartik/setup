#!/usr/bin/env node
/**
 * `npm run role:list` — read-only overview of the permission system and the
 * platform configuration, straight from the database (the source of truth).
 *
 * Prints: roles → permissions, who holds which role, and every platform setting
 * with its current value. Useful before and after deployment.
 */

import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireValue, banner, bad } from './lib/env.mjs';

const env = await loadEnv();
const url = requireValue(env, 'NEXT_PUBLIC_SUPABASE_URL');
const secret = requireValue(env, 'SUPABASE_SECRET_KEY');

const supabase = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

banner('Roles and permissions');
const { data: roles, error: rolesError } = await supabase
  .from('roles')
  .select('key,label,rank,is_staff,role_permissions ( permission_key )')
  .order('rank');
if (rolesError) {
  bad(rolesError.message);
  process.exit(1);
}
for (const role of roles) {
  const permissions = (role.role_permissions || []).map((p) => p.permission_key).sort();
  console.log(`\n  ${role.label} (${role.key}) — ${permissions.length} permissions${role.is_staff ? ', staff' : ''}`);
  console.log(`    ${permissions.join(', ') || '(none)'}`);
}

banner('Role holders');
const { data: holders } = await supabase
  .from('user_roles')
  .select('role_key, profiles ( username, display_name )')
  .order('role_key');
for (const holder of holders || []) {
  console.log(`  ${holder.role_key.padEnd(12)} @${holder.profiles?.username || '?'} (${holder.profiles?.display_name || '?'})`);
}
if (!holders?.length) console.log('  (nobody holds a role yet)');

banner('Platform settings');
const { data: settings, error: settingsError } = await supabase
  .from('platform_settings')
  .select('key,value,description,category,is_public')
  .order('category')
  .order('key');
if (settingsError) {
  bad(settingsError.message);
  process.exit(1);
}
for (const setting of settings) {
  console.log(`  [${setting.category}] ${setting.key} = ${JSON.stringify(setting.value)}${setting.is_public ? ' (public)' : ''}`);
}

banner('Feature flags');
const { data: flags } = await supabase.from('feature_flags').select('key,enabled').order('key');
for (const flag of flags || []) console.log(`  ${flag.enabled ? 'on ' : 'off'}  ${flag.key}`);
console.log('');
