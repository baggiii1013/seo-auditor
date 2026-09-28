// The app's JWT, checked against a key generated here rather than the real one.
//
//   node --test lib/github-app.test.ts        (or: npm run test:app)
//
// It is the one piece of the GitHub App with no request to fail loudly on: a
// JWT signed wrong, or with the wrong clock, just gets a 401 from GitHub that
// reads like a bad key in .env.local.

import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';

import { appJwt } from './github-app.ts';

test('the app JWT is RS256, verifies against the public key, and fits GitHub’s ten minutes', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const now = Date.UTC(2026, 0, 1);

  const [head, body, signature] = appJwt('Iv23client', pem, now).split('.');
  const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString());

  assert.deepEqual(decode(head), { alg: 'RS256', typ: 'JWT' });
  const claims = decode(body);
  assert.equal(claims.iss, 'Iv23client');
  assert.ok(claims.iat < now / 1000, 'backdated for clock drift');
  assert.ok(claims.exp - claims.iat <= 600, 'GitHub refuses a JWT that lives over ten minutes');
  assert.ok(createVerify('RSA-SHA256').update(`${head}.${body}`).verify(publicKey, signature, 'base64url'));
});
