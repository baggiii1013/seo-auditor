// The two decisions in lib/github.ts, checked without a network.
//
//   node --test lib/github.test.ts     (or: npm run test:app)
//
// `classify` is here because it got it wrong once, against a real repository:
// matching any path ending in `/robots.txt` reported one of next.js's own test
// fixtures as the site's robots.txt. The monorepo case below is that bug.
//
// `parseRepo` is here because its output is interpolated into a GitHub API
// path, which makes it the trust boundary — and a trust boundary with no test
// is a trust boundary nobody has checked.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classify, parseRepo } from './github.ts';

const of = (files: ReturnType<typeof classify>, name: string) => files.find((f) => f.name === name)!;

test('a file at the repository root is present', () => {
  const files = classify(['robots.txt', 'README.md'], false);
  assert.equal(of(files, 'robots.txt').state, 'present');
  assert.equal(of(files, 'robots.txt').path, 'robots.txt');
});

test('a file one directory down is present — that is where frameworks put it', () => {
  for (const dir of ['public', 'static', 'www', 'app']) {
    const files = classify([`${dir}/sitemap.xml`], false);
    assert.equal(of(files, 'sitemap.xml').state, 'present', dir);
    assert.equal(of(files, 'sitemap.xml').path, `${dir}/sitemap.xml`);
  }
});

test('a fixture deep in a monorepo is not the site’s robots.txt', () => {
  // The real path, from vercel/next.js. Reported as `present` by the first
  // version of this function, which is a report claiming next.js serves a
  // robots.txt it does not serve.
  const files = classify(['test/e2e/app-dir-export/app/robots.txt'], false);
  const robots = of(files, 'robots.txt');

  assert.equal(robots.state, 'unknown');
  assert.notEqual(robots.state, 'present');
  // …and not `missing` either: something was found, and saying nothing was is
  // its own false claim.
  assert.match(robots.why ?? '', /too deep/);
});

test('a shallow copy wins over a deep one', () => {
  const files = classify(['test/e2e/fixture/app/robots.txt', 'public/robots.txt'], false);
  assert.equal(of(files, 'robots.txt').state, 'present');
  assert.equal(of(files, 'robots.txt').path, 'public/robots.txt');
});

test('absence from a truncated tree is unknown, never missing', () => {
  const whole = classify(['README.md'], false);
  assert.equal(of(whole, 'llms.txt').state, 'missing');

  const cut = classify(['README.md'], true);
  assert.equal(of(cut, 'llms.txt').state, 'unknown');
  assert.match(of(cut, 'llms.txt').why ?? '', /truncated/);
});

test('a name is matched whole, not as a suffix', () => {
  // `not-robots.txt` ends with the string but is not the file.
  const files = classify(['public/not-robots.txt'], false);
  assert.equal(of(files, 'robots.txt').state, 'missing');
});

test('parseRepo takes the three spellings people actually have', () => {
  for (const input of [
    'acme/website',
    'https://github.com/acme/website',
    'https://www.github.com/acme/website/',
    'git@github.com:acme/website.git',
    '  acme/website  ',
  ]) {
    assert.deepEqual(parseRepo(input), { owner: 'acme', name: 'website' }, input);
  }

  // A dot is legal inside a name, and this one is a real repository.
  assert.deepEqual(parseRepo('acme/.github'), { owner: 'acme', name: '.github' });
});

test('parseRepo refuses anything that would not be a repository path', () => {
  for (const input of [
    '',
    'acme',
    'acme/website/extra',
    '../../etc/passwd',
    'acme/web site',
    'acme/..',
    'https://gitlab.com/acme/website',
  ]) {
    assert.equal(parseRepo(input), null, input);
  }
});
