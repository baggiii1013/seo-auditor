import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32, inflateRawSync } from 'node:zlib';

import { xlsx } from './xlsx.ts';

test('an xlsx is a zip whose sheets hold the cells, escaped', () => {
  const file = xlsx([{ name: 'One', widths: [10], rows: [['head'], ['a < b & "c"\x1b[31m'], [3]] }]);
  const parts = new Map<string, string>();
  for (let at = 0; file.readUInt32LE(at) === 0x04034b50; ) {
    const size = file.readUInt32LE(at + 18);
    const name = file.subarray(at + 30, at + 30 + file.readUInt16LE(at + 26)).toString();
    const raw = inflateRawSync(file.subarray(at + 30 + name.length, at + 30 + name.length + size));
    assert.equal(crc32(raw), file.readUInt32LE(at + 14), name);
    parts.set(name, raw.toString());
    at += 30 + name.length + size;
  }
  assert.ok(parts.has('[Content_Types].xml') && parts.has('xl/workbook.xml'));
  const sheet = parts.get('xl/worksheets/sheet1.xml')!;
  assert.match(sheet, /<t xml:space="preserve">a &lt; b &amp; &quot;c&quot;\[31m<\/t>/);
  assert.match(sheet, /<c r="A3" s="2"><v>3<\/v><\/c>/);
});
