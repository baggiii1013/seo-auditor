import assert from 'node:assert/strict';
import { test } from 'node:test';

import { diffLines } from './diff.ts';

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`);

test('one changed line, with its context, and the rest folded', () => {
  const before = lines(20);
  const after = [...before];
  after[10] = 'changed';
  assert.deepEqual(diffLines(before.join('\n'), after.join('\n'), 2), [
    { op: '…', count: 8 },
    { op: ' ', text: 'line 8' },
    { op: ' ', text: 'line 9' },
    { op: '-', text: 'line 10' },
    { op: '+', text: 'changed' },
    { op: ' ', text: 'line 11' },
    { op: ' ', text: 'line 12' },
    { op: '…', count: 7 },
  ]);
});

test('insertions between matches, and a new file is all additions', () => {
  assert.deepEqual(
    diffLines('a\nc', 'a\nb\nc').map((l) => ('text' in l ? l.op + l.text : '…')),
    [' a', '+b', ' c'],
  );
  assert.deepEqual(diffLines('', 'x\ny\n'), [
    { op: '+', text: 'x' },
    { op: '+', text: 'y' },
  ]);
});
