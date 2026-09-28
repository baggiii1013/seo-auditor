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
  LOCAL_USER,
  forgetGithubAccount,
  githubAccount,
  linkRepo,
  linkedRepo,
  linkedRepos,
  openDb,
  saveGithubAccount,
  siteKey,
  unlinkRepo,
} from './db.ts';

const root = mkdtempSync(join(tmpdir(), 'seo-auditor-db-'));
const db = openDb(root);

after(() => rmSync(root, { recursive: true, force: true }));

test('the one local user is seeded, once', () => {
  const rows = db.prepare('SELECT id, name FROM users').all();
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].id), LOCAL_USER);

  // Opening again must not seed a second one — `next dev` re-evaluates the
  // module on every edit and each evaluation calls through here.
  openDb(root);
  assert.equal(db.prepare('SELECT count(*) AS n FROM users').get()!.n, 1);
});

test('a site with no repository reads as null rather than throwing', () => {
  assert.equal(linkedRepo(db, LOCAL_USER, 'https://nothing-here.example'), null);
});

test('a link is found again under every spelling of its origin', () => {
  linkRepo(db, LOCAL_USER, 'https://acme.com', { owner: 'acme', name: 'website', branch: null });

  // The audit form takes whatever was typed, so these all have to land on the
  // same row. This is the failure the normalisation exists to prevent: a link
  // made from the address bar and invisible to a report run from a bookmark.
  for (const spelling of ['https://acme.com', 'https://acme.com/', 'HTTPS://Acme.com', 'https://acme.com/pricing']) {
    const found = linkedRepo(db, LOCAL_USER, spelling);
    assert.ok(found, `not found under ${spelling}`);
    assert.equal(found.owner, 'acme');
    assert.equal(found.name, 'website');
  }

  // …and a different site must not find it.
  assert.equal(linkedRepo(db, LOCAL_USER, 'https://acme.co.uk'), null);
});

test('siteKey keeps a port and leaves an unparseable origin alone', () => {
  assert.equal(siteKey('http://localhost:3000/report'), 'http://localhost:3000');
  assert.equal(siteKey('  Not A URL '), 'not a url');
});

test('re-linking edits the row rather than adding one', () => {
  const first = linkedRepo(db, LOCAL_USER, 'https://acme.com')!;

  const second = linkRepo(db, LOCAL_USER, 'https://acme.com/', {
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
  const repo = linkRepo(db, LOCAL_USER, 'https://other.example', { owner: 'o', name: 'n' });
  assert.equal(repo.branch, null);
});

test('unlinking reports whether there was anything to unlink', () => {
  assert.equal(unlinkRepo(db, LOCAL_USER, 'https://acme.com'), true);
  assert.equal(unlinkRepo(db, LOCAL_USER, 'https://acme.com'), false);
  assert.equal(linkedRepo(db, LOCAL_USER, 'https://acme.com'), null);
});

test('linkedRepos is keyed the way the report looks it up', () => {
  linkRepo(db, LOCAL_USER, 'HTTPS://Keyed.example/pricing', { owner: 'a', name: 'b' });
  assert.equal(linkedRepos(db, LOCAL_USER)[siteKey('https://keyed.example/')]?.name, 'b');
});

test('a GitHub account is saved once, replaced on reconnect, and forgotten', () => {
  assert.equal(githubAccount(db, LOCAL_USER), null);
  saveGithubAccount(db, LOCAL_USER, { login: 'one', token: 't1', refreshToken: 'r1', expiresAt: null });
  const two = { login: 'two', token: 't2', refreshToken: 'r2', expiresAt: '2026-01-01T08:00:00.000Z' };
  saveGithubAccount(db, LOCAL_USER, two);
  assert.deepEqual(githubAccount(db, LOCAL_USER), two);
  forgetGithubAccount(db, LOCAL_USER);
  assert.equal(githubAccount(db, LOCAL_USER), null);
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
  assert.equal(linkedRepo(store, LOCAL_USER, 'https://old.example')?.installationId, null);
  assert.equal(githubAccount(store, LOCAL_USER), null);
  const linked = linkRepo(store, LOCAL_USER, 'https://old.example', { owner: 'a', name: 'b', installationId: 42 });
  assert.equal(linked.installationId, 42);
});
