import { randomUUID } from 'node:crypto';

import { handle } from '@/engine/worker/index.mjs';
import { library } from '@/engine/src/library.mjs';

// A crawl is minutes, not seconds. Meaningless in `next dev`; the number that
// matters once this is deployed somewhere with a ceiling.
export const maxDuration = 800;

// The worker's password gate is satisfied rather than skipped — the same
// reasoning as engine/src/serve.mjs. A bypass inside the engine is a bypass
// that reaches production one refactor later, so mint a token and present it.
const TOKEN = randomUUID();

const env: Record<string, unknown> = {
  AUDIT_TOKEN: TOKEN,
  // This app is the person running it. PageSpeed spends their quota, Search
  // Console reads their account, crt.sh spends their rate limit — all theirs to
  // spend. Serving strangers means deleting these three lines.
  ALLOW_PSI: '1',
  ALLOW_SEARCH_CONSOLE: '1',
  ALLOW_HOSTS: '1',
  // node:tls is real here, so the certificate checks are too. The hosted Worker
  // leaves this unset and reports `tls-not-checked` rather than quietly passing.
  CAN_READ_CERTIFICATES: '1',
  // Every finished run, kept in the same folder the CLI's `--reports` lists.
  STORE: library(),
};

/** Re-address an `/api/engine/<path>` request as the `/<path>` the worker
 *  matches on, and hand it over. The worker is written against Request and
 *  Response and so is this route, so there is nothing to translate. */
async function proxy(request: Request, ctx: RouteContext<'/api/engine/[...path]'>) {
  const { path } = await ctx.params;
  const incoming = new URL(request.url);
  const target = new URL(`/${(path ?? []).join('/')}${incoming.search}`, incoming.origin);

  const headers = new Headers(request.headers);
  headers.set('authorization', `Bearer ${TOKEN}`);

  const body =
    request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();

  return handle(new Request(target, { method: request.method, headers, body }), env, null);
}

export const GET = proxy;
export const POST = proxy;
