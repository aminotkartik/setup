import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildBundle } from '../scripts/build-sql-bundle.mjs';

/**
 * The SQL bundle is a *tracked generated file*: it exists so a deployment can be
 * done entirely from the Supabase Dashboard SQL Editor, without the CLI and
 * without running any Node tooling first. Tracking generated output is only safe
 * if it cannot silently drift from the migration history — these tests are that
 * guarantee.
 */

const ROOT = process.cwd();
const BUNDLE = path.join(ROOT, 'supabase', 'bundle', 'campus-plus-schema.sql');
const migrationsDir = path.join(ROOT, 'supabase', 'migrations');

const migrationFiles = fs
  .readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

describe('supabase/bundle/campus-plus-schema.sql', () => {
  it('exists and is committed (tracked by git, not ignored)', () => {
    expect(fs.existsSync(BUNDLE)).toBe(true);
    const ignored = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    expect(ignored).not.toMatch(/^supabase\/bundle/m);
  });

  it('is exactly what the generator produces today (regenerate with npm run db:bundle)', async () => {
    const { content } = await buildBundle();
    const committed = fs.readFileSync(BUNDLE, 'utf8');
    expect(committed).toBe(content);
  });

  it('contains every migration, in filename order', async () => {
    const { files } = await buildBundle();
    expect(files).toEqual(migrationFiles);
    const bundle = fs.readFileSync(BUNDLE, 'utf8');
    let cursor = -1;
    for (const [index, file] of migrationFiles.entries()) {
      const marker = `-- FILE ${String(index + 1).padStart(2, '0')}/${migrationFiles.length}  ${file}`;
      const at = bundle.indexOf(marker);
      expect(at, `${marker} missing from the bundle`).toBeGreaterThan(-1);
      expect(at, `${file} is out of order in the bundle`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('is a single runnable script: no psql meta-commands, no unclosed dollar quotes', () => {
    const bundle = fs.readFileSync(BUNDLE, 'utf8');
    // `\i`, `\ir`, `\!` etc. are psql client commands the SQL Editor cannot run.
    expect(bundle).not.toMatch(/^\s*\\[a-z!]/m);
    const dollars = (bundle.match(/\$\$/g) || []).length;
    expect(dollars % 2, 'unbalanced $$ dollar quotes').toBe(0);
    expect(bundle.trimEnd().endsWith(';')).toBe(true);
  });

  it('creates the objects the application needs, in dependency order', () => {
    const bundle = fs.readFileSync(BUNDLE, 'utf8');
    const indexOf = (pattern) => bundle.search(pattern);

    // Enums first, then tables, then policies/functions, then seed data.
    expect(indexOf(/create type public\.account_status/)).toBeLessThan(indexOf(/create table public\.profiles/));
    expect(indexOf(/create table public\.profiles/)).toBeLessThan(indexOf(/create table public\.posts/));
    expect(indexOf(/create table public\.posts/)).toBeLessThan(indexOf(/create policy posts_\w+ on public\.posts/));
    expect(indexOf(/create policy posts_\w+ on public\.posts/)).toBeLessThan(
      indexOf(/insert into public\.permissions/),
    );
    expect(indexOf(/insert into public\.permissions/)).toBeLessThan(
      indexOf(/insert into public\.role_permissions/),
    );
  });

  it('ships the reference data a deployment needs to be usable', () => {
    const bundle = fs.readFileSync(BUNDLE, 'utf8');
    for (const table of [
      'colleges', 'roles', 'permissions', 'role_permissions',
      'marketplace_categories', 'feature_flags', 'platform_settings',
    ]) {
      expect(bundle, `no seed rows for ${table}`).toMatch(new RegExp(`insert into public\\.${table} `));
    }
    expect(bundle).toMatch(/pccoepune\.org/);
  });

  it('enables row level security for every table it creates', () => {
    const bundle = fs.readFileSync(BUNDLE, 'utf8');
    const created = [...bundle.matchAll(/create table (?:if not exists )?public\.([a-z_]+)/g)].map((m) => m[1]);
    const enabled = new Set(
      [...bundle.matchAll(/alter table (?:only )?public\.([a-z_]+)\s+enable row level security/g)].map((m) => m[1]),
    );
    // A couple of pure reference tables are intentionally readable by everyone
    // and are covered by the audit script's allow-list instead.
    const exempt = new Set(['colleges', 'roles', 'permissions', 'role_permissions', 'marketplace_categories']);
    const missing = [...new Set(created)].filter((table) => !enabled.has(table) && !exempt.has(table));
    expect(missing).toEqual([]);
  });
});
