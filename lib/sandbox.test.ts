// The sandbox's plan, always; the container itself only with FIX_SANDBOX set
// (docker or podman), because it needs one:
//
//   FIX_SANDBOX=podman node --test lib/sandbox.test.ts

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { test } from 'node:test';

import { broke, openBox, plan, prepareSandbox } from './sandbox.ts';

test('the lockfile picks the installer, and only build and lint are checks', () => {
  assert.deepEqual(plan(['index.html'], null), { install: null, scripts: [] });
  const pkg = JSON.stringify({ scripts: { build: 'next build', lint: 'eslint', dev: 'next dev' } });
  assert.deepEqual(plan(['package.json', 'package-lock.json'], pkg), {
    install: ['npm', 'ci'],
    scripts: [
      ['npm', 'run', 'build'],
      ['npm', 'run', 'lint'],
    ],
  });
  assert.deepEqual(plan(['package.json', 'pnpm-lock.yaml'], '{}').install, ['pnpm', 'install', '--frozen-lockfile']);
  assert.deepEqual(plan(['package.json'], 'not json'), { install: ['npm', 'install'], scripts: [] });
});

test('offline, writes thrown away, and only what the changes broke counts', { skip: !process.env.FIX_SANDBOX }, async () => {
  await prepareSandbox();
  const dir = mkdtempSync(join(tmpdir(), 'sandbox-test-'));
  const repo = join(dir, 'repo');
  const files = {
    'package.json': JSON.stringify({ scripts: { build: 'node build.js', lint: 'node -e "process.exit(1)"' } }),
    'build.js': "if (require('fs').readFileSync('page.html', 'utf8').includes('BROKEN')) process.exit(1);",
    'page.html': '<h1>Home</h1>',
  };
  mkdirSync(repo);
  for (const [path, text] of Object.entries(files)) writeFileSync(join(repo, path), text);

  const box = await openBox({
    id: 'sandbox-test',
    tarball: Readable.from([execFileSync('tar', ['cz', '-C', dir, 'repo'])]),
    paths: Object.keys(files),
    pkg: files['package.json'],
    signal: new AbortController().signal,
    say: () => {},
  });
  try {
    // Nothing directly, and through the proxy only Google Fonts.
    const get = (url: string, proxy = '') =>
      box.run(`${proxy} node -e "fetch('${url}').then((r) => process.exit(r.ok ? 0 : 4), () => process.exit(3))"`, []);
    assert.match(await get('https://example.com'), /^exit 3/);
    assert.match(await get('https://example.com', 'NODE_USE_ENV_PROXY=1'), /^exit 3/);
    assert.match(await get('https://fonts.googleapis.com/css2?family=Inter', 'NODE_USE_ENV_PROXY=1'), /^exit 0/);

    const change = (path: string, after: string) => ({ path, before: null, after });
    assert.match(await box.run('cat page.html', [change('page.html', '<h1>Acme</h1>')]), /Acme/);
    await box.run('echo scribbled > page.html', []);
    assert.match(await box.run('cat page.html', []), /Home/);

    const checks = await box.verify([change('page.html', 'BROKEN'), change('bad.php', '<?php echo (;')]);
    assert.deepEqual(
      checks.map((c) => [c.command, c.ok, c.before, broke(c)]),
      [
        ['php -l bad.php', false, undefined, true],
        ['npm run build', false, true, true],
        ['npm run lint', false, false, false],
      ],
    );
    const fine = await box.verify([change('page.html', '<h1>Acme</h1>'), change('ok.php', '<?php echo 1;')]);
    assert.deepEqual(
      fine.map((c) => broke(c)),
      [false, false, false],
    );
  } finally {
    await box.close();
  }
});
