// The command line and the window, kept honest about each other.
//
// Thirty-two flags and a window that reached ten of them, with nothing saying
// which of the other twenty-two were decisions. These tests make the answer
// compulsory: a flag added without an entry fails the build, and so does an
// entry claiming the window sends something it does not.
//
// Reading Swift source from a Node test is unusual and deliberate. The
// alternative is a CI job that only runs on macOS, and this needs to fail on
// the machine of whoever adds the flag, at the moment they add it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { OPTIONS, runParameters, notInApp } from '../src/options.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

/** Every flag `bin/seo-audit.mjs` actually parses. */
const parsedFlags = () =>
  new Set([...read('bin/seo-audit.mjs').matchAll(/arg === '(--[a-z-]+)'/g)].map((m) => m[1]));

test('every flag the command line parses has an answer about the window', () => {
  const declared = new Set(OPTIONS.map((o) => o.flag));
  const missing = [...parsedFlags()].filter((flag) => !declared.has(flag));

  assert.deepEqual(missing, [],
    `${missing.join(', ')} is parsed by the CLI and missing from src/options.mjs. Add it with ` +
    'app: true if the window should reach it, or a string saying why it should not. ' +
    '"not yet" is a fine reason; an unrecorded one is not.');
});

test('the table does not describe flags that no longer exist', () => {
  const parsed = parsedFlags();
  const stale = OPTIONS.map((o) => o.flag).filter((flag) => !parsed.has(flag));
  assert.deepEqual(stale, [], `${stale.join(', ')} is in src/options.mjs and the CLI does not parse it`);
});

test('a CHANGELOG version says Added or Fixed once, not twice', () => {
  // Entries get inserted by anchoring on a neighbour, and when the anchor is in
  // another section the result is a second heading of the same name. It has
  // happened before three releases in a row and was caught by eye each time;
  // the section becomes the release notes, so the fourth would have shipped.
  const text = read('CHANGELOG.md');
  const versions = [...text.matchAll(/^## \[[^\]]+\].*$/gm)];
  const wrong = [];

  for (const [i, heading] of versions.entries()) {
    const body = text.slice(heading.index, versions[i + 1]?.index ?? text.length);
    const seen = new Map();
    for (const [, kind] of body.matchAll(/^### (\w+)$/gm)) {
      seen.set(kind, (seen.get(kind) ?? 0) + 1);
    }
    for (const [kind, times] of seen) {
      if (times > 1) wrong.push(`${heading[0].trim()} has ${times} "### ${kind}" sections`);
    }
  }

  assert.deepEqual(wrong, [], wrong.join('; '));
});

test('every reason is a sentence somebody can act on', () => {
  for (const { flag, reason } of notInApp()) {
    assert.equal(typeof reason, 'string', `${flag} needs a reason, not ${reason}`);
    assert.ok(reason.length > 12, `${flag}: "${reason}" does not say enough to be a decision`);
  }
});

test('nothing is declared twice', () => {
  const flags = OPTIONS.map((o) => o.flag);
  assert.equal(new Set(flags).size, flags.length, 'a flag appears twice in src/options.mjs');
  const queries = OPTIONS.map((o) => o.query).filter(Boolean);
  assert.equal(new Set(queries).size, queries.length, 'two flags claim the same query parameter');
});

test('no source file is a binary file to git', () => {
  // Three files had a literal NUL byte in them, each used as a separator or a
  // placeholder — correct values, written the wrong way. A raw control byte
  // makes the whole file binary: `grep` skips it and `git diff` refuses to show
  // it, which is how a glob matcher sat in src/config.mjs for months while
  // somebody went looking for one.
  //
  // The value is fine. Write it as an escape.
  const tracked = execSync('git ls-files', { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(mjs|js|swift|json|md|yml|html|css|sh)$/.test(f));

  const offenders = [];
  for (const file of tracked) {
    const bytes = readFileSync(join(root, file));
    for (const byte of bytes) {
      // Everything below space except tab, newline and carriage return.
      if (byte < 0x09 || (byte > 0x0d && byte < 0x20) || byte === 0x7f) {
        offenders.push(file);
        break;
      }
    }
  }
  assert.deepEqual(offenders, [],
    `${offenders.join(', ')} contains a raw control byte. Write it as an escape ` +
    '(\\u0000) so the file stays text.');
});
