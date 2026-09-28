import { randomUUID } from 'node:crypto';

import { guardFetches } from '@/engine/src/http.mjs';
import { handle } from '@/engine/worker/index.mjs';

import { refuseInternal } from './ssrf';

// The one way into the vendored engine. Routes name the three things the app
// uses — preview, stream, render — and nothing else of the worker is reachable:
// its report library, compare and export pages are not served to anyone.

// The worker's password gate is satisfied rather than skipped: a bypass inside
// the engine is a bypass that reaches production one refactor later.
const TOKEN = randomUUID();

const on = (name: string) => (process.env[name] === '1' ? '1' : undefined);

const env: Record<string, unknown> = {
  AUDIT_TOKEN: TOKEN,
  // Off unless the operator says otherwise in .env: PageSpeed spends their
  // Google quota, Search Console reads their account, crt.sh spends their IP's
  // rate limit — none of it a stranger's to spend.
  ALLOW_PSI: on('ALLOW_PSI'),
  ALLOW_SEARCH_CONSOLE: on('ALLOW_SEARCH_CONSOLE'),
  ALLOW_HOSTS: on('ALLOW_HOSTS'),
  // Node can open the TLS socket a certificate is read over.
  CAN_READ_CERTIFICATES: '1',
  MAX_PAGES: process.env.MAX_PAGES,
  MAX_CONCURRENCY: process.env.MAX_CONCURRENCY,
};

/** Whether a gated form control should be drawn — the same answer the worker
 *  will give when the run arrives. */
export const allowed = (gate: string) => env[gate] === '1';

/** Why `url` may not be fetched from this server, or `null`. Opt out with
 *  ALLOW_PRIVATE_HOSTS=1 only to audit sites on your own network, and never on
 *  a public deployment. */
export const refuse = (url: string) => (process.env.ALLOW_PRIVATE_HOSTS === '1' ? null : refuseInternal(url));

// Every fetch a crawl makes asks it first — a sitemap or a link can name an
// internal address just as well as the form can.
guardFetches(async (url) => refuse(url));

export function engine(path: 'preview' | 'stream' | 'render', search: URLSearchParams, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${TOKEN}`);
  return handle(new Request(`http://engine/${path}?${search}`, { ...init, headers }), env, null);
}
