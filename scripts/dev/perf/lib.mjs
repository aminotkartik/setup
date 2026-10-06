#!/usr/bin/env node
/**
 * Shared helpers for the local performance harness (development tool).
 *
 * Boots the same disposable PostgreSQL cluster the migration tests use (so the
 * schema, RLS policies and SQL functions under measurement are the real ones)
 * and exposes the constants the harness reports against.
 *
 * Nothing here ships to production: `scripts/` is dev-only tooling.
 */

import { readdir, readFile, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const migrationsDir = path.join(root, 'supabase/migrations');
export const perfDir = path.join(root, 'node_modules/.cache/perf');

export const PG_PORT = Number(process.env.PERF_PG_PORT || 55433);
export const DB_NAME = 'campus_plus_perf';
export const DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/${DB_NAME}`;
/** Fixed RTT applied to every upstream Supabase request (ms). */
export const RTT_MS = Number(process.env.PERF_RTT_MS || 25);
/** Published keys the app is configured with while measuring. */
export const PUBLISHABLE_KEY = 'sb_publishable_perf_harness_key';
export const SECRET_KEY = 'sb_secret_perf_harness_key';

export function banner(text) {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

/**
 * Boot the embedded cluster and return a client connected to a *freshly created*
 * perf database. The admin client stays on `postgres` so the database can be
 * dropped between runs without dropping the connection it runs on.
 */
export async function startDatabase({ port = PG_PORT, database = DB_NAME } = {}) {
  const mod = await import('embedded-postgres');
  const EmbeddedPostgres = mod.default;
  const dataDir = path.join(root, 'node_modules/.cache/perf-pg-data');
  await mkdir(path.dirname(dataDir), { recursive: true });
  const fresh = !existsSync(path.join(dataDir, 'PG_VERSION'));

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: true,
  });

  if (fresh) await pg.initialise();
  await pg.start();
  const admin = pg.getPgClient('postgres');
  await admin.connect();
  await recreateDatabase(admin, { database });
  const client = pg.getPgClient(database);
  await client.connect();
  return { pg, admin, client, fresh };
}

/** Recreate the perf database from scratch so every run starts identical. */
export async function recreateDatabase(client, { database = DB_NAME } = {}) {
  await client.query(
    `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
    [database],
  );
  await client.query(`drop database if exists ${database}`);
  await client.query(`create database ${database}`);
}

/** Apply the authoritative migration history (postgres role, like `db push`). */
export async function applyMigrations(client) {
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      error.migrationFile = file;
      throw error;
    }
  }
  return files;
}

export { rm, mkdir, path };
