#!/usr/bin/env node
/**
 * `npm run check:env` — configuration audit.
 *
 * Verifies, without contacting the network:
 *   - every variable the app needs is present and not a placeholder,
 *   - no secret value hides in a NEXT_PUBLIC_* variable (it would ship to the
 *     browser bundle),
 *   - `.env.local` is git-ignored,
 *   - the Supabase URL/key shapes look right.
 *
 * Exit code 0 means "safe to boot"; 1 means "something must be fixed first".
 * The app itself still boots with missing keys and shows a setup screen — this
 * script exists so the operator finds out before deploying (spec §92, §115).
 */

import { loadEnv, value, looksLikeSecretKey, banner, ok, bad, warn } from './lib/env.mjs';
import { execFileSync } from 'node:child_process';

const env = await loadEnv();
let failures = 0;

banner('Campus+ environment check');

const checks = [
  {
    key: 'NEXT_PUBLIC_SUPABASE_URL',
    required: true,
    hint: 'Supabase → Project Settings → Data API → Project URL',
    validate: (v) => /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(v) || 'must look like https://<ref>.supabase.co',
  },
  {
    key: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    required: true,
    hint: 'Supabase → Project Settings → API Keys → Publishable key (anon)',
    validate: (v) => (looksLikeSecretKey(v) ? 'this is a service_role/secret key — never expose it to the browser' : true),
  },
  {
    key: 'SUPABASE_SECRET_KEY',
    required: false,
    hint: 'Needed by the maintenance scripts only (seed, roles, security verification).',
    validate: (v) => (looksLikeSecretKey(v) ? true : 'does not look like a secret key (sb_secret_… or service_role JWT)'),
  },
  {
    key: 'CAMPUS_ALLOWED_EMAIL_DOMAINS',
    required: false,
    validate: (v) => (/^[a-z0-9.-]+(,[a-z0-9.-]+)*$/i.test(v) ? true : 'comma-separated domains, e.g. pccoepune.org'),
  },
  {
    key: 'GIPHY_API_KEY',
    required: false,
    hint: 'Optional until you want the GIF picker; becomes required by docs/DEPLOYMENT.md.',
  },
  {
    key: 'GIPHY_CONTENT_RATING',
    required: false,
    validate: (v) => (['g', 'pg', 'pg-13', 'r'].includes(v.toLowerCase()) ? true : 'one of g | pg | pg-13 | r'),
  },
];

for (const check of checks) {
  const found = value(env, check.key);
  if (!found) {
    if (check.required) {
      bad(`${check.key} is missing${check.hint ? ` — ${check.hint}` : ''}`);
      failures += 1;
    } else {
      warn(`${check.key} not set${check.hint ? ` — ${check.hint}` : ''}`);
    }
    continue;
  }
  const verdict = check.validate ? check.validate(found) : true;
  if (verdict === true) {
    ok(`${check.key} looks valid`);
  } else {
    bad(`${check.key}: ${verdict}`);
    failures += 1;
  }
}

// A NEXT_PUBLIC_* variable must never hold a secret.
for (const key of Object.keys(env)) {
  if (!key.startsWith('NEXT_PUBLIC_')) continue;
  if (looksLikeSecretKey(value(env, key))) {
    bad(`${key} contains a service-role/secret key; NEXT_PUBLIC_* values are bundled for the browser`);
    failures += 1;
  }
}

// `.env.local` must be ignored by git before it ever holds a real key.
try {
  const ignored = execFileSync('git', ['check-ignore', '.env.local'], { cwd: process.cwd(), stdio: 'pipe' })
    .toString()
    .trim();
  if (ignored) ok('.env.local is git-ignored');
  else {
    bad('.env.local is NOT git-ignored — remove it from version control before adding real keys');
    failures += 1;
  }
} catch {
  warn('not a git checkout, skipped the .env.local ignore check');
}

if (failures) {
  console.error(`\n${failures} problem${failures === 1 ? '' : 's'} to fix — see docs/DEPLOYMENT.md.\n`);
  process.exit(1);
}
console.log('\nEnvironment looks ready. Start the app with `npm run dev`.\n');
