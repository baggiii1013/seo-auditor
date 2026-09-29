// The write path, against a GitHub that is a function. What it must never do
// is touch the base branch, and what it must do is survive being asked twice.
//
//   node --test lib/github-write.test.ts     (or: npm run test:app)

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openPullRequest } from './github-write.ts';

type Call = { method: string; path: string; body: Record<string, unknown> | null };

function github(answers: Record<string, [number, object]>) {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://api.github.com/repos/acme/site', '');
    const method = init.method ?? 'GET';
    calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : null });
    const [status, body] = answers[`${method} ${path.split('?')[0]}`] ?? [500, {}];
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

const ask = {
  token: 't',
  owner: 'acme',
  name: 'site',
  base: 'main',
  sha: 'base-sha',
  branch: 'seo-auditor/2026-09-28-abcd1234',
  files: [{ path: 'public/llms.txt', content: '# Acme\n' }],
  title: 'SEO: No llms.txt',
  body: 'body',
};

test('one tree, one commit on the base, a new branch, a pull request', async () => {
  const calls = github({
    'POST /git/trees': [201, { sha: 'tree-sha' }],
    'POST /git/commits': [201, { sha: 'commit-sha' }],
    'POST /git/refs': [201, {}],
    'POST /pulls': [201, { number: 7, html_url: 'https://github.com/acme/site/pull/7' }],
  });
  assert.deepEqual(await openPullRequest(ask), { ok: true, number: 7, url: 'https://github.com/acme/site/pull/7' });
  assert.equal(calls[0].body!.base_tree, 'base-sha');
  assert.deepEqual(calls[1].body!.parents, ['base-sha']);
  assert.equal(calls[2].body!.ref, `refs/heads/${ask.branch}`);
  assert.deepEqual(calls[3].body, { title: ask.title, head: ask.branch, base: 'main', body: 'body' });
  assert.ok(calls.every((c) => !c.path.includes('heads/main')), 'something wrote to the base branch');
});

test('a retry moves its own branch and finds the pull request already open', async () => {
  const calls = github({
    'POST /git/trees': [201, { sha: 'tree-sha' }],
    'POST /git/commits': [201, { sha: 'commit-sha' }],
    'POST /git/refs': [422, { message: 'Reference already exists' }],
    [`PATCH /git/refs/heads/${ask.branch}`]: [200, {}],
    'POST /pulls': [422, { message: 'A pull request already exists' }],
    'GET /pulls': [200, [{ number: 7, html_url: 'u' }]],
  });
  assert.deepEqual(await openPullRequest(ask), { ok: true, number: 7, url: 'u' });
  assert.equal(calls.filter((c) => c.method === 'POST' && c.path === '/pulls').length, 1);
});

test('missing write permission says what to change', async () => {
  github({ 'POST /git/trees': [403, { message: 'Resource not accessible by integration' }] });
  const res = await openPullRequest(ask);
  assert.equal(res.ok, false);
  assert.match(!res.ok ? res.reason : '', /Contents.*Pull requests/);
});
