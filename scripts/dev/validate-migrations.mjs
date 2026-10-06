#!/usr/bin/env node
/**
 * Local schema validation (development tool).
 *
 * Boots a disposable PostgreSQL instance, installs the minimal Supabase
 * compatibility surface, applies the authoritative migration history in
 * `supabase/migrations/` in order, then runs the SQL test suites in
 * `database/tests/`.
 *
 * Usage:
 *   npm install --no-save embedded-postgres
 *   npm run db:test            # or: node scripts/dev/validate-migrations.mjs
 *
 * Production migrations run through the Supabase CLI (`supabase db push`).
 */

import { banner, applyMigrations, runTestSuites, shutdown, startDatabase, migrationFiles } from './harness.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { migrationsDir } from './harness.mjs';

async function main() {
  const { pg, client } = await startDatabase({ port: 55432 });

  const files = await migrationFiles();
  let failed = false;

  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    process.stdout.write(`  → ${file} … `);
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('commit');
      console.log('\x1b[32mok\x1b[0m');
    } catch (error) {
      await client.query('rollback');
      console.log('\x1b[31mFAILED\x1b[0m');
      console.error(`\n  ${error.message}`);
      const position = error.position ? Number(error.position) : null;
      if (position) {
        const lines = sql.split('\n');
        const lineNo = sql.slice(0, position).split('\n').length;
        for (let i = Math.max(0, lineNo - 4); i < Math.min(lines.length, lineNo + 3); i += 1) {
          const marker = i === lineNo - 1 ? '»' : ' ';
          console.error(`  ${marker} ${String(i + 1).padStart(4)} | ${lines[i]}`);
        }
      }
      failed = true;
      break;
    }
  }

  if (failed) {
    await shutdown(pg, client);
    process.exit(1);
  }

  banner('Installing test helpers…');
  const { TEST_HELPER_SQL } = await import('./harness.mjs');
  await client.query(TEST_HELPER_SQL);

  banner('Running database test suites…');
  const results = await runTestSuites(client, {
    onSuite: (file) => process.stdout.write(`  → ${file} … `),
  });

  let testsFailed = false;
  for (const result of results) {
    if (result.ok) {
      console.log('\x1b[32mpassed\x1b[0m');
      continue;
    }
    console.log('\x1b[31mFAILED\x1b[0m');
    console.error(`\n  ${result.error.message}`);
    if (result.error.failedStatement) {
      const preview = result.error.failedStatement.split('\n').slice(0, 4).join('\n      ');
      console.error(`\n  failed statement:\n      ${preview}`);
    }
    testsFailed = true;
  }

  await shutdown(pg, client);

  if (testsFailed) {
    console.error('\n\x1b[31mTest suites failed.\x1b[0m');
    process.exit(1);
  }

  banner('All migrations applied cleanly and every test suite passed.');
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
