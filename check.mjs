// The app end to end, over HTTP: a crawl queued, followed and finished, its
// report exported by every writer, and the doors that must stay shut, shut.
//
// Needs the app running:  npm start &  then  npm run check
import assert from 'node:assert/strict';

const base = process.env.BASE ?? 'http://localhost:3000';
const site = process.env.SITE ?? 'https://example.com';

// 1. Only the routes the app uses are served. The old catch-all handed the
//    worker's whole surface — the report library among it — to anyone.
assert.equal((await fetch(`${base}/api/engine/reports`)).status, 404, 'the engine proxy is back');
const inside = await fetch(`${base}/api/audits?url=${encodeURIComponent('http://169.254.169.254/')}`, { method: 'POST' });
assert.equal(inside.status, 400, 'an internal address was accepted for a crawl');

/** Queue a crawl and read its event stream to the end. */
async function crawl(url, extra = '') {
  const queued = await fetch(`${base}/api/audits?url=${encodeURIComponent(url)}${extra}`, { method: 'POST' });
  assert.equal(queued.status, 202, `queueing answered ${queued.status}: ${await queued.clone().text()}`);
  const { id } = await queued.json();
  const events = await fetch(`${base}/api/audits/${id}/events`);
  assert.equal(events.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  return { id, body: await events.text() };
}

// 2. The SSE contract the client parses: progress lines, then one done event
//    carrying the whole report.
const { id, body } = await crawl(site, '&limit=1');
assert.ok(body.includes('event: progress'), 'no progress events arrived');

const done = body.split('event: done\ndata: ')[1];
assert.ok(done, `the stream never finished:\n${body.slice(-400)}`);
const report = JSON.parse(done.split('\n\n')[0]);
for (const key of ['id', 'meta', 'findings', 'causes', 'score']) {
  assert.ok(key in report, `the report is missing ${key}`);
}
assert.equal(typeof report.score.score, 'number', 'nothing was scored');

// 2b. The three row shapes scoreRun() returns are not the same shape, and
//     app/report.tsx has to read all three through one list. A failed row has
//     no `pass` — asserted here rather than assumed, because assuming it is
//     how `row.pass.toLowerCase()` reached the check filter and took the whole
//     report down on the first keystroke someone typed into it.
for (const row of report.score.passed ?? []) {
  assert.equal(typeof row.pass, 'string', `passed row ${row.id} lost its sentence`);
}
if (report.score.failed?.length) {
  assert.ok(
    report.score.failed.every((row) => row.id && row.area),
    'a failed row arrived without an id or an area to label it by',
  );
}

// 3. Every export writer stays in the engine — app/report.tsx formats nothing
//    itself, so this is the only thing standing between it and a saved file.
const rendered = {};
for (const [as, expected] of [['markdown', '# SEO audit'], ['csv', '"level"'], ['html', '<!']]) {
  const res = await fetch(`${base}/api/audits/${id}/export?as=${as}`);
  assert.equal(res.status, 200, `export as ${as} answered ${res.status}`);
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

// 5. A host that answers nothing. The engine finishes normally and reports it
//    as a finding, but the done payload carries no `score` key at all — so
//    anything reading `report.score.score` throws on a plain typo in the URL
//    box, which is the most ordinary way to use this thing wrong.
const { body: deadBody } = await crawl('https://this-site-does-not-exist-9f2a7c.com');
const deadDone = deadBody.split('event: done\ndata: ')[1];
assert.ok(deadDone, 'an unreachable host never produced a done event');
const deadReport = JSON.parse(deadDone.split('\n\n')[0]);
assert.ok(
  deadReport.score === undefined || deadReport.score.score === null,
  'an unreachable host must score null or not at all, never a number',
);
assert.ok(
  deadReport.causes?.some((cause) => cause.id === 'unreachable'),
  'nothing in the report says the site never answered',
);

console.log(`ok — closed doors, queued crawl, stream, row shapes, unreachable host and all three writers,
     against ${site} (scored ${report.score.score})`);
