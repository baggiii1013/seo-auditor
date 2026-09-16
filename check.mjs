// The one thing that breaks silently: app/api/engine/[...path]/route.ts strips
// the /api/engine prefix and injects the worker's bearer token. Get either
// wrong and every route 404s or 401s — which from the browser looks like "the
// engine is broken" rather than "the proxy is".
//
// Needs the app running:  npm start &  then  npm run check
import assert from 'node:assert/strict';

const base = process.env.BASE ?? 'http://localhost:3000';
const site = process.env.SITE ?? 'https://example.com';
const api = (path) => `${base}/api/engine/${path}`;

// 1. The prefix is stripped, and the bearer token satisfies the gate. A 401
//    here is the token; a 404 is the rewrite.
const options = await fetch(api('options'));
assert.equal(options.status, 200, `/options answered ${options.status}`);
const { run } = await options.json();
assert.ok(run.some((o) => o.flag === '--limit'), 'the flag table came back empty');

// 2. The SSE contract the client parses: progress lines, then one done event
//    carrying the whole report.
const stream = await fetch(api(`stream?url=${encodeURIComponent(site)}&limit=1&format=json`));
assert.equal(stream.headers.get('content-type'), 'text/event-stream; charset=utf-8');
const body = await stream.text();
assert.ok(body.includes('event: progress'), 'no progress events arrived');

const done = body.split('event: done\ndata: ')[1];
assert.ok(done, `the stream never finished:\n${body.slice(-400)}`);
const report = JSON.parse(done.split('\n\n')[0]);
for (const key of ['meta', 'findings', 'causes', 'score']) {
  assert.ok(key in report, `the report is missing ${key}`);
}
assert.equal(typeof report.score.score, 'number', 'nothing was scored');

// 3. Every export writer stays in the engine — app/report.tsx formats nothing
//    itself, so this is the only thing standing between it and a saved file.
const rendered = {};
for (const [as, expected] of [['markdown', '# SEO audit'], ['csv', '"level"'], ['html', '<!']]) {
  const res = await fetch(api(`render?as=${as}`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ meta: report.meta, findings: report.findings, score: report.score }),
  });
  assert.equal(res.status, 200, `/render?as=${as} answered ${res.status}`);
  rendered[as] = await res.text();
  assert.ok(rendered[as].trimStart().startsWith(expected), `${as} came back wrong`);
}

// 4. The headline counts app/report.tsx draws must be the ones the Markdown
//    prints. Counting `causes` instead of `findings` reads as a smaller number
//    — plausible, wrong, and invisible without comparing the two documents.
const tally = { error: 0, warn: 0, note: 0 };
for (const f of report.findings) tally[f.level === 'info' ? 'note' : f.level]++;
const said = rendered.markdown.match(/\*\*(\d+) errors?, (\d+) warnings?, (\d+) notes?\*\*/);
assert.ok(said, 'the Markdown no longer prints a counts line to compare against');
assert.deepEqual(
  [tally.error, tally.warn, tally.note],
  said.slice(1, 4).map(Number),
  'the UI tally and the Markdown disagree',
);

console.log(`ok — proxy, stream and all three writers, against ${site} (scored ${report.score.score})`);
