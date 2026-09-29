// The store, checked against a real SQLite file in a temp folder.
//
//   node --test lib/db.test.ts        (or: npm run test:app)
//
// No framework and no fixtures — node:test and node:assert, the same two the
// engine's suite next door runs on. What it is here to catch is the pair of
// things that would silently corrupt a link: an origin that normalises
// differently on write than on read, and a re-link that inserts a second row
// instead of editing the one that is there.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';

import {
  abandonAudits,
  abandonJobs,
  createAudit,
  createJob,
  createSession,
  endSession,
  finishAudit,
  finishJob,
  forgetGithubAccount,
  getAudit,
  getJob,
  githubAccount,
  linkRepo,
  linkedRepo,
  linkedRepos,
  openDb,
  repoJobs,
  saveGithubAccount,
  sessionCookie,
  sessionUser,
  siteKey,
  startAudit,
  unlinkRepo,
  userForGithub,
} from './db.ts';

const root = mkdtempSync(join(tmpdir(), 'seo-auditor-db-'));
const db = openDb(root);

after(() => rmSync(root, { recursive: true, force: true }));

const USER = userForGithub(db, 101, 'someone');

test('a user is made once per GitHub account, and follows a renamed login', () => {
  assert.equal(userForGithub(db, 101, 'renamed'), USER);
  assert.equal(db.prepare('SELECT name FROM users WHERE id = ?').get(USER)!.name, 'renamed');
  assert.notEqual(userForGithub(db, 202, 'other'), USER);
});

test('a session cookie finds its user until it expires or ends', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const token = createSession(db, USER, now);
  assert.equal(sessionUser(db, token, now), USER);
  // Only the hash is stored: the cookie value itself is nowhere in the file.
  assert.equal(db.prepare('SELECT count(*) AS n FROM sessions WHERE id = ?').get(token)!.n, 0);
  assert.equal(sessionUser(db, 'forged', now), null);
  assert.equal(sessionUser(db, token, now + 31 * 86_400_000), null);
  endSession(db, token);
  assert.equal(sessionUser(db, token, now), null);
});

test('the session cookie is Secure only when the request came over HTTPS', () => {
  // `next start` on http://localhost: production, but plain http. A Secure
  // cookie here is dropped by Firefox and the sign-in silently goes nowhere.
  const local = sessionCookie(new Request('http://localhost:3000/api/git/callback'), 't');
  assert.match(local, /^sid=t; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/);
  assert.match(sessionCookie(new Request('https://seo.example/api/git/callback'), 't'), /; Secure$/);
  // Behind a TLS-terminating proxy the app itself sees http.
  const proxied = new Request('http://10.0.0.5:3000/api/git/callback', { headers: { 'x-forwarded-proto': 'https' } });
  assert.match(sessionCookie(proxied, 't'), /; Secure$/);
  assert.match(sessionCookie(new Request('http://localhost/'), '', 0), /Max-Age=0$/);
});

test('an audit is queued, run, finished, and swept after a restart', () => {
  createAudit(db, { id: 'a1', url: 'https://acme.com', params: 'url=https%3A%2F%2Facme.com' });
  assert.equal(getAudit(db, 'a1')?.status, 'queued');
  startAudit(db, 'a1');
  finishAudit(db, 'a1', { result: '{"meta":{}}' });
  assert.equal(getAudit(db, 'a1')?.status, 'done');

  createAudit(db, { id: 'a2', url: 'https://acme.com', params: '' });
  startAudit(db, 'a2');
  assert.equal(abandonAudits(db, 'restarted'), 1);
  assert.deepEqual([getAudit(db, 'a2')?.status, getAudit(db, 'a2')?.error], ['failed', 'restarted']);
  assert.equal(getAudit(db, 'a1')?.status, 'done', 'a finished audit is left alone');

  // A week on, the next audit clears out the old ones.
  createAudit(db, { id: 'a3', url: 'https://acme.com', params: '' }, Date.now() + 8 * 86_400_000);
  assert.equal(getAudit(db, 'a1'), null);
});

test('a site with no repository reads as null rather than throwing', () => {
  assert.equal(linkedRepo(db, USER, 'https://nothing-here.example'), null);
});

test('a link is found again under every spelling of its origin', () => {
  linkRepo(db, USER, 'https://acme.com', { owner: 'acme', name: 'website', branch: null });

  // The audit form takes whatever was typed, so these all have to land on the
  // same row. This is the failure the normalisation exists to prevent: a link
  // made from the address bar and invisible to a report run from a bookmark.
  for (const spelling of ['https://acme.com', 'https://acme.com/', 'HTTPS://Acme.com', 'https://acme.com/pricing']) {
    const found = linkedRepo(db, USER, spelling);
    assert.ok(found, `not found under ${spelling}`);
    assert.equal(found.owner, 'acme');
    assert.equal(found.name, 'website');
  }

  // …and a different site must not find it.
  assert.equal(linkedRepo(db, USER, 'https://acme.co.uk'), null);
});

test('siteKey keeps a port and leaves an unparseable origin alone', () => {
  assert.equal(siteKey('http://localhost:3000/report'), 'http://localhost:3000');
  assert.equal(siteKey('  Not A URL '), 'not a url');
});

test('re-linking edits the row rather than adding one', () => {
  const first = linkedRepo(db, USER, 'https://acme.com')!;

  const second = linkRepo(db, USER, 'https://acme.com/', {
    owner: 'acme',
    name: 'marketing-site',
    branch: 'next',
  });

  assert.equal(second.id, first.id, 'the row id should survive a re-link');
  assert.equal(second.name, 'marketing-site');
  assert.equal(second.branch, 'next');
  assert.equal(db.prepare('SELECT count(*) AS n FROM repos').get()!.n, 1);
});

test('an empty branch is stored as null, meaning the default branch', () => {
  const repo = linkRepo(db, USER, 'https://other.example', { owner: 'o', name: 'n' });
  assert.equal(repo.branch, null);
});

test('unlinking reports whether there was anything to unlink', () => {
  assert.equal(unlinkRepo(db, USER, 'https://acme.com'), true);
  assert.equal(unlinkRepo(db, USER, 'https://acme.com'), false);
  assert.equal(linkedRepo(db, USER, 'https://acme.com'), null);
});

test('linkedRepos is keyed the way the report looks it up', () => {
  linkRepo(db, USER, 'HTTPS://Keyed.example/pricing', { owner: 'a', name: 'b' });
  assert.equal(linkedRepos(db, USER)[siteKey('https://keyed.example/')]?.name, 'b');
});

test('a GitHub account is saved once, replaced on reconnect, and forgotten', () => {
  assert.equal(githubAccount(db, USER), null);
  saveGithubAccount(db, USER, { login: 'one', token: 't1', refreshToken: 'r1', expiresAt: null });
  const two = { login: 'two', token: 't2', refreshToken: 'r2', expiresAt: '2026-01-01T08:00:00.000Z' };
  saveGithubAccount(db, USER, two);
  assert.deepEqual(githubAccount(db, USER), two);
  forgetGithubAccount(db, USER);
  assert.equal(githubAccount(db, USER), null);
});

test('a store from before the GitHub App is migrated in place', () => {
  const old = mkdtempSync(join(tmpdir(), 'seo-auditor-db-old-'));
  after(() => rmSync(old, { recursive: true, force: true }));
  const raw = new DatabaseSync(join(old, 'app.db'));
  raw.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE repos (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, origin TEXT NOT NULL,
      owner TEXT NOT NULL, name TEXT NOT NULL, branch TEXT, created_at TEXT NOT NULL, UNIQUE (user_id, origin));
    CREATE TABLE github_accounts (user_id INTEGER PRIMARY KEY, login TEXT NOT NULL, token TEXT NOT NULL,
      created_at TEXT NOT NULL);
    INSERT INTO users VALUES (1, 'local', 'then');
    INSERT INTO repos (user_id, origin, owner, name, created_at) VALUES (1, 'https://old.example', 'a', 'b', 'then');
    INSERT INTO github_accounts VALUES (1, 'someone', 'gho_oauth_app_token', 'then');
  `);
  raw.close();

  const store = openDb(old);
  // The link survives, with no installation; the OAuth app's token does not.
  assert.equal(linkedRepo(store, 1, 'https://old.example')?.installationId, null);
  assert.equal(githubAccount(store, 1), null);
  const linked = linkRepo(store, 1, 'https://old.example', { owner: 'a', name: 'b', installationId: 42 });
  assert.equal(linked.installationId, 42);
});

test('one fix runs per user at a time, and a restart fails the one running', () => {
  const fixer = userForGithub(db, 202, 'fixer');
  const repo = linkRepo(db, fixer, 'https://fix.test', { owner: 'acme', name: 'site' });
  const job = (id: string) => ({ id, userId: fixer, repoId: repo.id, auditId: 'a', input: { checks: ['llms-missing'] } });
  createJob(db, job('j1'));
  assert.throws(() => createJob(db, job('j2')), 'a second running fix was let in');
  finishJob(db, 'j1', { error: 'nope' });
  createJob(db, job('j2'));
  assert.equal(abandonJobs(db, 'restarted'), 1);
  assert.deepEqual([getJob(db, 'j2')?.status, getJob(db, 'j2')?.error], ['failed', 'restarted']);
  assert.deepEqual(repoJobs(db, repo.id).map((j) => j.input.checks), [['llms-missing'], ['llms-missing']]);
});
