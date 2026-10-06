/**
 * Shared helpers for the operator scripts (Node, no Next.js runtime).
 *
 * These scripts talk to Supabase with the *secret* key, so they must never be
 * imported from application code. They read configuration from the same
 * `.env.local` / `.env` files the app uses, without pulling in a dependency.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

/** Minimal dotenv parser: KEY=value, `export ` prefix, # comments, quotes. */
export function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

/**
 * Load `.env.local` (then `.env`), letting real environment variables win so
 * `SUPABASE_SECRET_KEY=... npm run role:grant` works in CI without a file.
 */
export async function loadEnv({ files = ['.env.local', '.env'] } = {}) {
  const merged = {};
  for (const file of files) {
    try {
      const text = await readFile(path.join(root, file), 'utf8');
      Object.assign(merged, parseEnv(text));
    } catch {
      // Missing file is normal: the operator may export variables instead.
    }
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string' && value.length) merged[key] = value;
  }
  return merged;
}

const PLACEHOLDER = /^YOUR_|^your_|^<|^changeme$/i;

export function value(env, key) {
  const raw = env[key];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || PLACEHOLDER.test(trimmed)) return null;
  return trimmed;
}

export function requireValue(env, key, hint) {
  const found = value(env, key);
  if (!found) {
    console.error(`\n  ✗ Missing ${key}.${hint ? `\n    ${hint}` : ''}\n`);
    process.exit(1);
  }
  return found;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const [key, inline] = token.slice(2).split('=');
      if (inline !== undefined) args[key] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) args[key] = argv[++i];
      else args[key] = true;
    } else {
      args._.push(token);
    }
  }
  return args;
}

/** True when the key we are about to use looks like a Supabase secret key. */
export function looksLikeSecretKey(key) {
  if (!key) return false;
  if (key.startsWith('sb_secret_')) return true;
  // Legacy service_role JWTs carry a "role":"service_role" claim.
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      return payload?.role === 'service_role';
    } catch {
      return false;
    }
  }
  return false;
}

export function banner(text) {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

export function ok(text) {
  console.log(`  \x1b[32m✓\x1b[0m ${text}`);
}

export function bad(text) {
  console.log(`  \x1b[31m✗\x1b[0m ${text}`);
}

export function warn(text) {
  console.log(`  \x1b[33m!\x1b[0m ${text}`);
}
