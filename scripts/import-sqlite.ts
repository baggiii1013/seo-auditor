// One-off: copy the old SQLite store (app.db) into the Postgres at DATABASE_URL.
//
//   node --env-file=.env.local --no-warnings scripts/import-sqlite.ts [path/to/app.db]
//
// Defaults to the app.db in the engine's library folder, where the store used
// to live. Safe to run twice: a row already there is left as it is. The file
// itself is only read; delete it once the app runs happily on Postgres.

import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { libraryRoot } from '../engine/src/library.mjs';
import { openDb } from '../lib/db.ts';

const file = process.argv[2] ?? join(libraryRoot(), 'app.db');
const old = new DatabaseSync(file, { readOnly: true });
const db = await openDb();

// Parents before children, for the foreign keys.
const TABLES = ['users', 'sessions', 'audits', 'repos', 'jobs', 'github_accounts'];

await db.begin(async (tx) => {
  for (const table of TABLES) {
    const rows = old.prepare(`SELECT * FROM ${table}`).all();
    let copied = 0;
    for (const row of rows) copied += (await tx`INSERT INTO ${tx(table)} ${tx(row)} ON CONFLICT DO NOTHING`).count;
    console.log(`${table}: ${copied} of ${rows.length} copied`);
  }
  // The ids came along as they were, so the next new row starts after them.
  for (const table of ['users', 'repos']) {
    await tx.unsafe(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'), coalesce(max(id), 0) + 1, false) FROM ${table}`,
    );
  }
});

old.close();
await db.end();
