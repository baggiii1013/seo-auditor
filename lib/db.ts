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
// Nobody signs in to audit. A user row exists only once someone continues with
// GitHub to link a repository, keyed by their GitHub id, and a browser holds
// only a random session id that points at it — tokens never leave the server.

import { createHash, randomBytes } from 'node:crypto';
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
  /** The GitHub App installation that grants access to it. `null` on a link
   *  made before the app, which still reads — as the env token or anonymously —
   *  but cannot be written to. */
  installationId: number | null;
  createdAt: string;
};

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    github_id  INTEGER,
    created_at TEXT NOT NULL
  );

  -- The id is a hash of the cookie, so a copy of this file opens no browser's
  -- session.
  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );

  -- One crawl. Nobody owns it: the id is random, and whoever holds it can read it.
  CREATE TABLE IF NOT EXISTS audits (
    id          TEXT PRIMARY KEY,
    url         TEXT NOT NULL,
    params      TEXT NOT NULL,
    status      TEXT NOT NULL,
    result      TEXT,
    error       TEXT,
    created_at  TEXT NOT NULL,
    finished_at TEXT
  );

  CREATE TABLE IF NOT EXISTS repos (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    origin     TEXT NOT NULL,
    owner      TEXT NOT NULL,
    name       TEXT NOT NULL,
    branch     TEXT,
    installation_id INTEGER,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, origin)
  );

  CREATE TABLE IF NOT EXISTS github_accounts (
    user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    login         TEXT NOT NULL,
    token         TEXT NOT NULL,
    refresh_token TEXT,
    expires_at    TEXT,
    created_at    TEXT NOT NULL
  );
`;

/** Columns added after a table first shipped. `CREATE TABLE IF NOT EXISTS`
 *  leaves an existing table exactly as it was, so a store from before the
 *  change needs telling. */
function migrate(db: DatabaseSync): void {
  const has = (table: string, column: string) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);

  if (!has('repos', 'installation_id')) db.exec('ALTER TABLE repos ADD COLUMN installation_id INTEGER');
  if (!has('users', 'github_id')) db.exec('ALTER TABLE users ADD COLUMN github_id INTEGER');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_github_id ON users (github_id)');

  // A token from the OAuth app the GitHub App replaced cannot do anything the
  // app's can, so the row is dropped rather than carried: connect once more.
  if (!has('github_accounts', 'refresh_token')) {
    db.exec('DROP TABLE github_accounts');
    db.exec(SCHEMA);
  }
}

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
  migrate(db);

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
  installationId: row.installation_id == null ? null : Number(row.installation_id),
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
  repo: { owner: string; name: string; branch?: string | null; installationId?: number | null },
): Repo {
  db.prepare(
    `INSERT INTO repos (user_id, origin, owner, name, branch, installation_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, origin)
     DO UPDATE SET owner = excluded.owner, name = excluded.name, branch = excluded.branch,
                   installation_id = excluded.installation_id`,
  ).run(
    userId,
    siteKey(origin),
    repo.owner,
    repo.name,
    repo.branch ?? null,
    repo.installationId ?? null,
    new Date().toISOString(),
  );

  return linkedRepo(db, userId, origin)!;
}

/** Forget the repository linked to `origin`. `false` when there was none. */
export function unlinkRepo(db: DatabaseSync, userId: number, origin: string): boolean {
  return db.prepare('DELETE FROM repos WHERE user_id = ? AND origin = ?').run(userId, siteKey(origin)).changes > 0;
}

/** The GitHub account a user signed in with through the GitHub App.
 *
 *  `token` is the app's user token: it expires after eight hours, and
 *  `refreshToken` buys a new one — see `userToken()` in lib/git-state.ts.
 *
 *  ponytail: the tokens sit in plain text in app.db, beside the reports — same
 *  trust as the machine it runs on. Encrypt at rest the day this is hosted. */
export type GithubAccount = {
  login: string;
  token: string;
  refreshToken: string | null;
  /** ISO time the token stops working. `null` when the app does not expire them. */
  expiresAt: string | null;
};

export function githubAccount(db: DatabaseSync, userId: number): GithubAccount | null {
  const row = db
    .prepare('SELECT login, token, refresh_token, expires_at FROM github_accounts WHERE user_id = ?')
    .get(userId);
  if (!row) return null;
  return {
    login: String(row.login),
    token: String(row.token),
    refreshToken: row.refresh_token == null ? null : String(row.refresh_token),
    expiresAt: row.expires_at == null ? null : String(row.expires_at),
  };
}

export function saveGithubAccount(db: DatabaseSync, userId: number, account: GithubAccount): void {
  db.prepare(
    `INSERT INTO github_accounts (user_id, login, token, refresh_token, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET login = excluded.login, token = excluded.token,
       refresh_token = excluded.refresh_token, expires_at = excluded.expires_at`,
  ).run(userId, account.login, account.token, account.refreshToken, account.expiresAt, new Date().toISOString());
}

export function forgetGithubAccount(db: DatabaseSync, userId: number): void {
  db.prepare('DELETE FROM github_accounts WHERE user_id = ?').run(userId);
}

/** The user behind a GitHub account, made on their first sign-in. Keyed by
 *  GitHub's numeric id, which survives a renamed login. */
export function userForGithub(db: DatabaseSync, githubId: number, login: string): number {
  db.prepare(
    `INSERT INTO users (name, github_id, created_at) VALUES (?, ?, ?)
     ON CONFLICT (github_id) DO UPDATE SET name = excluded.name`,
  ).run(login, githubId, new Date().toISOString());
  return Number(db.prepare('SELECT id FROM users WHERE github_id = ?').get(githubId)!.id);
}

const SESSION_DAYS = 30;
const hashed = (token: string) => createHash('sha256').update(token).digest('hex');

/** A new session for `userId`. The return value goes in the browser's cookie
 *  and nowhere else — only its hash is kept. */
export function createSession(db: DatabaseSync, userId: number, now = Date.now()): string {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date(now).toISOString());
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(now + SESSION_DAYS * 86_400_000).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(hashed(token), userId, expires);
  return token;
}

export const SESSION_COOKIE = 'sid';

/** The cookie that keeps a browser signed in. HttpOnly, so no script on the
 *  page can read it. Secure when the request arrived over HTTPS — asked of the
 *  request, not of NODE_ENV: `next start` on http://localhost is production,
 *  and Firefox silently drops a Secure cookie sent over plain http. */
export function sessionCookie(request: Request, token: string, maxAge = SESSION_DAYS * 86_400): string {
  const https =
    (request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '')) === 'https';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${https ? '; Secure' : ''}`;
}

/** Whose cookie this is, or `null` for a stranger, a forgery or an old one. */
export function sessionUser(db: DatabaseSync, token: string, now = Date.now()): number | null {
  const row = db.prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?').get(hashed(token));
  if (!row || String(row.expires_at) < new Date(now).toISOString()) return null;
  return Number(row.user_id);
}

export function endSession(db: DatabaseSync, token: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(hashed(token));
}

export type AuditStatus = 'queued' | 'running' | 'done' | 'failed';

export type Audit = {
  id: string;
  url: string;
  /** The query string the run was asked with — everything needed to start it. */
  params: string;
  status: AuditStatus;
  /** The finished report, as JSON. */
  result: string | null;
  error: string | null;
  createdAt: string;
};

/** How long a finished report stays fetchable. */
const KEEP_DAYS = 7;

export function createAudit(db: DatabaseSync, audit: { id: string; url: string; params: string }, now = Date.now()): void {
  const cutoff = new Date(now - KEEP_DAYS * 86_400_000).toISOString();
  db.prepare('DELETE FROM audits WHERE created_at < ?').run(cutoff);
  db.prepare('INSERT INTO audits (id, url, params, status, created_at) VALUES (?, ?, ?, ?, ?)').run(
    audit.id,
    audit.url,
    audit.params,
    'queued',
    new Date(now).toISOString(),
  );
}

export function startAudit(db: DatabaseSync, id: string): void {
  db.prepare("UPDATE audits SET status = 'running' WHERE id = ?").run(id);
}

export function finishAudit(db: DatabaseSync, id: string, outcome: { result: string } | { error: string }): void {
  db.prepare('UPDATE audits SET status = ?, result = ?, error = ?, finished_at = ? WHERE id = ?').run(
    'result' in outcome ? 'done' : 'failed',
    'result' in outcome ? outcome.result : null,
    'error' in outcome ? outcome.error : null,
    new Date().toISOString(),
    id,
  );
}

export function getAudit(db: DatabaseSync, id: string): Audit | null {
  const row = db.prepare('SELECT * FROM audits WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: String(row.id),
    url: String(row.url),
    params: String(row.params),
    status: String(row.status) as AuditStatus,
    result: row.result == null ? null : String(row.result),
    error: row.error == null ? null : String(row.error),
    createdAt: String(row.created_at),
  };
}

/** Runs a previous process started and never finished. The queue lives in
 *  memory, so after a restart nothing will ever pick these up again. */
export function abandonAudits(db: DatabaseSync, reason: string): number {
  return Number(
    db
      .prepare("UPDATE audits SET status = 'failed', error = ?, finished_at = ? WHERE status IN ('queued', 'running')")
      .run(reason, new Date().toISOString()).changes,
  );
}
