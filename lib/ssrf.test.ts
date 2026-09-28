import assert from 'node:assert/strict';
import { test } from 'node:test';

import { internalAddress, refuseInternal } from './ssrf.ts';

test('private, loopback and metadata addresses are refused', () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(internalAddress(a), true, a);
  }
});

test('public addresses pass', () => {
  for (const a of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(internalAddress(a), false, a);
  }
});

test('URLs naming internal hosts are refused before any request', async () => {
  assert.ok(await refuseInternal('http://169.254.169.254/latest/meta-data/'));
  assert.ok(await refuseInternal('http://[::1]:3000/'));
  assert.ok(await refuseInternal('http://localhost:5432/'));
  assert.ok(await refuseInternal('http://app.localhost/'));
  assert.equal(await refuseInternal('https://8.8.8.8/'), null);
});
