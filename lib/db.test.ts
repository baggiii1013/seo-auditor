// The store, checked against a real Postgres, in a schema of its own that is
// dropped afterwards — DATABASE_URL's data is never touched.
//
//   DATABASE_URL=postgres://… node --test lib/db.test.ts   (or: npm run test:app)
//
// No framework and no fixtures — node:test and node:assert, the same two the
// engine's suite next door runs on. What it is here to catch is the pair of
// things that would silently corrupt a link: an origin that normalises
// differently on write than on read, and a re-link that inserts a second row
// instead of editing the one that is there.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import postgres from 'postgres';

import {
  abandonAudits,
  abandonJobs,
  claimJob,
  createAudit,
  createJob,
  createSession,
  endSession,
  finishAudit,
  forgetGithubAccount,
  getAudit,
  getJob,
  githubAccount,
  linkRepo,
  linkedRepo,
  linkedRepos,
  openDb,
  repoJobs,
  stopJob,
  stopsAsked,
  saveGithubAccount,
  sessionCookie,
  sessionUser,
  siteKey,
  startAudit,
  unlinkRepo,
  userForGithub,
  type Db,
} from './db.ts';

const url = process.env.DATABASE_URL;

describe('the store', { skip: !url && 'set DATABASE_URL to a Postgres to run these' }, () => {
  const schema = `test_${randomBytes(6).toString('hex')}`;
  const admin = postgres(url!, { onnotice: () => {} });
  let db: Db;
  let USER: number;

  before(async () => {
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    const scoped = new URL(url!);
    scoped.searchParams.set('search_path', schema);
    db = await openDb(scoped.href);
    USER = await userForGithub(db, 101, 'someone');
  });

  after(async () => {
    await db?.end();
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  test('a user is made once per GitHub account, and follows a renamed login', async () => {
    assert.equal(await userForGithub(db, 101, 'renamed'), USER);
    assert.equal((await db`SELECT name FROM users WHERE id = ${USER}`)[0].name, 'renamed');
    assert.notEqual(await userForGithub(db, 202, 'other'), USER);
  });

  test('a session cookie finds its user until it expires or ends', async () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    const token = await createSession(db, USER, now);
    assert.equal(await sessionUser(db, token, now), USER);
    // Only the hash is stored: the cookie value itself is nowhere in the table.
    assert.equal((await db`SELECT id FROM sessions WHERE id = ${token}`).length, 0);
    assert.equal(await sessionUser(db, 'forged', now), null);
    assert.equal(await sessionUser(db, token, now + 31 * 86_400_000), null);
    await endSession(db, token);
    assert.equal(await sessionUser(db, token, now), null);
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

  test('an audit is queued, run, finished, and swept after a restart', async () => {
    await createAudit(db, { id: 'a1', url: 'https://acme.com', params: 'url=https%3A%2F%2Facme.com' });
    assert.equal((await getAudit(db, 'a1'))?.status, 'queued');
    await startAudit(db, 'a1');
    await finishAudit(db, 'a1', { result: '{"meta":{}}' });
    assert.equal((await getAudit(db, 'a1'))?.status, 'done');

    await createAudit(db, { id: 'a2', url: 'https://acme.com', params: '' });
    await startAudit(db, 'a2');
    assert.equal(await abandonAudits(db, 'restarted'), 1);
    const a2 = await getAudit(db, 'a2');
    assert.deepEqual([a2?.status, a2?.error], ['failed', 'restarted']);
    assert.equal((await getAudit(db, 'a1'))?.status, 'done', 'a finished audit is left alone');

    // A week on, the next audit clears out the old ones.
    await createAudit(db, { id: 'a3', url: 'https://acme.com', params: '' }, Date.now() + 8 * 86_400_000);
    assert.equal(await getAudit(db, 'a1'), null);
  });

  test('a site with no repository reads as null rather than throwing', async () => {
    assert.equal(await linkedRepo(db, USER, 'https://nothing-here.example'), null);
  });

  test('a link is found again under every spelling of its origin', async () => {
    await linkRepo(db, USER, 'https://acme.com', { owner: 'acme', name: 'website', branch: null });

    // The audit form takes whatever was typed, so these all have to land on the
    // same row. This is the failure the normalisation exists to prevent: a link
    // made from the address bar and invisible to a report run from a bookmark.
    for (const spelling of ['https://acme.com', 'https://acme.com/', 'HTTPS://Acme.com', 'https://acme.com/pricing']) {
      const found = await linkedRepo(db, USER, spelling);
      assert.ok(found, `not found under ${spelling}`);
      assert.equal(found.owner, 'acme');
      assert.equal(found.name, 'website');
    }

    // …and a different site must not find it.
    assert.equal(await linkedRepo(db, USER, 'https://acme.co.uk'), null);
  });

  test('siteKey keeps a port and leaves an unparseable origin alone', () => {
    assert.equal(siteKey('http://localhost:3000/report'), 'http://localhost:3000');
    assert.equal(siteKey('  Not A URL '), 'not a url');
  });

  test('re-linking edits the row rather than adding one', async () => {
    const first = (await linkedRepo(db, USER, 'https://acme.com'))!;

    const second = await linkRepo(db, USER, 'https://acme.com/', {
      owner: 'acme',
      name: 'marketing-site',
      branch: 'next',
    });

    assert.equal(second.id, first.id, 'the row id should survive a re-link');
    assert.equal(second.name, 'marketing-site');
    assert.equal(second.branch, 'next');
    assert.equal((await db`SELECT id FROM repos`).length, 1);
  });

  test('an empty branch is stored as null, meaning the default branch', async () => {
    const repo = await linkRepo(db, USER, 'https://other.example', { owner: 'o', name: 'n' });
    assert.equal(repo.branch, null);
  });

  test('unlinking reports whether there was anything to unlink', async () => {
    assert.equal(await unlinkRepo(db, USER, 'https://acme.com'), true);
    assert.equal(await unlinkRepo(db, USER, 'https://acme.com'), false);
    assert.equal(await linkedRepo(db, USER, 'https://acme.com'), null);
  });

  test('linkedRepos is keyed the way the report looks it up', async () => {
    await linkRepo(db, USER, 'HTTPS://Keyed.example/pricing', { owner: 'a', name: 'b' });
    assert.equal((await linkedRepos(db, USER))[siteKey('https://keyed.example/')]?.name, 'b');
  });

  test('a GitHub account is saved once, replaced on reconnect, and forgotten', async () => {
    assert.equal(await githubAccount(db, USER), null);
    await saveGithubAccount(db, USER, { login: 'one', token: 't1', refreshToken: 'r1', expiresAt: null });
    const two = { login: 'two', token: 't2', refreshToken: 'r2', expiresAt: '2026-01-01T08:00:00.000Z' };
    await saveGithubAccount(db, USER, two);
    assert.deepEqual(await githubAccount(db, USER), two);
    await forgetGithubAccount(db, USER);
    assert.equal(await githubAccount(db, USER), null);
  });

  test('one fix per user queued or running; the worker claims, Stop ends, a restart fails the running', async () => {
    const fixer = await userForGithub(db, 202, 'fixer');
    const repo = await linkRepo(db, fixer, 'https://fix.test', { owner: 'acme', name: 'site' });
    const job = (id: string) => ({ id, userId: fixer, repoId: repo.id, auditId: 'a', input: { checks: ['llms-missing'] } });
    const status = async (id: string) => (await getJob(db, id))?.status;

    await createJob(db, job('j1'));
    assert.equal(await status('j1'), 'queued');
    await assert.rejects(createJob(db, job('j2')), 'a second fix was let in');
    await stopJob(db, 'j1', 'Stopped.');
    assert.equal(await status('j1'), 'failed', 'a queued job ends at once');

    await createJob(db, job('j2'));
    assert.equal((await claimJob(db))?.id, 'j2');
    assert.equal(await claimJob(db), null, 'claimed twice');
    await stopJob(db, 'j2', 'Stopped.');
    assert.deepEqual([await status('j2'), await stopsAsked(db)], ['running', ['j2']], 'a running job is only asked');
    await stopJob(db, 'j2', 'Stopped.');
    assert.equal(await status('j2'), 'failed', 'asked twice, it ends');

    await createJob(db, job('j3'));
    await claimJob(db);
    assert.equal(await abandonJobs(db, 'restarted'), 1);
    assert.deepEqual([await status('j3'), (await getJob(db, 'j3'))?.error], ['failed', 'restarted']);
    assert.equal((await repoJobs(db, repo.id)).length, 3);
  });
});
