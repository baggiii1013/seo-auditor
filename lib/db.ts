// The app's own store, kept beside the engine's report library.
//
// `node:sqlite` rather than a driver package. Node ships a SQLite binding and
// this needs two tables and four statements; a dependency for that is a
// dependency to keep patched forever. It prints an experimental warning, which
// means the *API* may move between major Node versions — not that it drops
// rows.
//
// The library root is a parameter rather than something this file resolves.
// Two reasons, and the second is the real one:
//
//   1. `@/engine/src/library.mjs` only resolves under the bundler, so a file
//      that imports it cannot be run by `node --test`. This one can.
//   2. A store that decides for itself where it lives cannot be pointed at a
//      temp folder, which means it cannot be tested without writing to the
//      operator's actual library.
//
// Every query takes a `userId`. There is no sign-in yet and `users` holds
// exactly one row — but queries written without one all have to be found and
// rewritten the day sign-in lands, and threading an argument nobody varies
// costs nothing today.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { siteKey } from './site-key.ts';

export { siteKey };

/** A repository linked to an audited site. */
export type Repo = {
  id: number;
  userId: number;
  /** The audited site this is linked to — a normalised `meta.origin`. */
  origin: string;
  owner: string;
  name: string;
  /** `null` means "whatever the repository calls its default branch", resolved
   *  at read time rather than frozen here — so a repo that renames `master` to
   *  `main` does not strand the link. */
  branch: string | null;
  createdAt: string;
};

/** The one user there is.
 *
 *  Sign-in will put real rows in this table; until then this id is what every
 *  query is scoped by, so nothing above this file has to know which of the two
 *  worlds it is running in. */
export const LOCAL_USER = 1;

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS repos (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    origin     TEXT NOT NULL,
    owner      TEXT NOT NULL,
    name       TEXT NOT NULL,
    branch     TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, origin)
  );

  CREATE TABLE IF NOT EXISTS github_accounts (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    login      TEXT NOT NULL,
    token      TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;

// One connection per root, not per import. `next dev` re-evaluates a module on
// every edit, and each evaluation opening its own handle is how a long dev
// session ends up holding a few dozen of them.
const connections = new Map<string, DatabaseSync>();

/** Open (and on first call, create) the store under `root`. */
export function openDb(root: string): DatabaseSync {
  const existing = connections.get(root);
  if (existing) return existing;

  mkdirSync(root, { recursive: true });
  const db = new DatabaseSync(join(root, 'app.db'));
  db.exec(SCHEMA);
  db.prepare('INSERT INTO users (id, name, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING').run(
    LOCAL_USER,
    'local',
    new Date().toISOString(),
  );

  connections.set(root, db);
  return db;
}

const toRepo = (row: Record<string, unknown>): Repo => ({
  id: Number(row.id),
  userId: Number(row.user_id),
  origin: String(row.origin),
  owner: String(row.owner),
  name: String(row.name),
  branch: row.branch == null ? null : String(row.branch),
  createdAt: String(row.created_at),
});

/** The repository linked to `origin`, or `null` when there is none. */
export function linkedRepo(db: DatabaseSync, userId: number, origin: string): Repo | null {
  const row = db.prepare('SELECT * FROM repos WHERE user_id = ? AND origin = ?').get(userId, siteKey(origin));
  return row ? toRepo(row) : null;
}

/** Every link the user has, keyed by site — what the page hands the report so
 *  it can draw the panel without asking the server again. */
export function linkedRepos(db: DatabaseSync, userId: number): Record<string, Repo> {
  const rows = db.prepare('SELECT * FROM repos WHERE user_id = ?').all(userId).map(toRepo);
  return Object.fromEntries(rows.map((repo) => [repo.origin, repo]));
}

/** Link a repository to `origin`, replacing whatever was linked before.
 *
 *  An upsert rather than a delete-then-insert: one site has one repository, so
 *  re-linking is an edit of that fact, and a row id that survives the edit is
 *  one anything referencing it can keep holding. */
export function linkRepo(
  db: DatabaseSync,
  userId: number,
  origin: string,
  repo: { owner: string; name: string; branch?: string | null },
): Repo {
  db.prepare(
    `INSERT INTO repos (user_id, origin, owner, name, branch, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, origin)
     DO UPDATE SET owner = excluded.owner, name = excluded.name, branch = excluded.branch`,
  ).run(userId, siteKey(origin), repo.owner, repo.name, repo.branch ?? null, new Date().toISOString());

  return linkedRepo(db, userId, origin)!;
}

/** Forget the repository linked to `origin`. `false` when there was none. */
export function unlinkRepo(db: DatabaseSync, userId: number, origin: string): boolean {
  return db.prepare('DELETE FROM repos WHERE user_id = ? AND origin = ?').run(userId, siteKey(origin)).changes > 0;
}

/** The GitHub account a user connected through the OAuth popup.
 *
 *  ponytail: the token sits in plain text in app.db, beside the reports — same
 *  trust as the machine it runs on. Encrypt at rest the day this is hosted. */
export type GithubAccount = { login: string; token: string };

export function githubAccount(db: DatabaseSync, userId: number): GithubAccount | null {
  const row = db.prepare('SELECT login, token FROM github_accounts WHERE user_id = ?').get(userId);
  return row ? { login: String(row.login), token: String(row.token) } : null;
}

export function saveGithubAccount(db: DatabaseSync, userId: number, account: GithubAccount): void {
  db.prepare(
    `INSERT INTO github_accounts (user_id, login, token, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET login = excluded.login, token = excluded.token`,
  ).run(userId, account.login, account.token, new Date().toISOString());
}

export function forgetGithubAccount(db: DatabaseSync, userId: number): void {
  db.prepare('DELETE FROM github_accounts WHERE user_id = ?').run(userId);
}
