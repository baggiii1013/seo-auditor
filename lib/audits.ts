import { randomUUID } from 'node:crypto';

import { abandonAudits, createAudit, finishAudit, getAudit, startAudit } from './db';
import { engine } from './engine';
import { store } from './store';

// Crawls as jobs, not as requests. A crawl is minutes; tied to the browser's
// connection it died with a closed laptop, and nothing capped how many ran at
// once. Now a request only *asks* for one: it is queued, runs here at most
// AUDIT_CONCURRENCY at a time, and its report lands in the store — where a
// reconnecting browser, an export, and later the fixer can all find it.
//
// ponytail: the queue and the live log are this process's memory. One Node
// process is the deployment this is written for; run more than one and the
// queue moves to the store, the log to wherever the processes can all see.

/** One line of the stream, already JSON — the SSE `data:` as the browser
 *  receives it. `seq` is the SSE id, so a reconnect resumes rather than
 *  replaying the log from the top. */
export type AuditEvent = { seq: number; event: 'progress' | 'done' | 'failed'; data: string };
type Listener = (event: AuditEvent) => void;

type Live = { ip: string; log: AuditEvent[]; seq: number; listeners: Set<Listener> };

const RUNNING = Number.parseInt(process.env.AUDIT_CONCURRENCY ?? '', 10) || 2;
/** Crawls one address may have queued or running at once. */
const PER_ADDRESS = 2;
/** The browser caps its own log at this; replaying more is bytes nobody sees. */
const KEEP_LINES = 400;

/** `ready`: the sweep of what an earlier process left, which a new row waits on
 *  so the sweep cannot catch it. */
type State = { live: Map<string, Live>; queue: string[]; running: number; ready: Promise<unknown> };

// On globalThis because `next dev` re-evaluates this file on every edit, and
// a fresh copy of this state would orphan the crawls the old one was running.
const g = globalThis as typeof globalThis & { __audits?: State };
function state(): State {
  if (!g.__audits) {
    // First use in this process: whatever an earlier one left half-done is
    // not coming back, and a browser waiting on it should hear so.
    const ready = store()
      .then((db) => abandonAudits(db, 'The server restarted before this audit finished. Run it again.'))
      .catch((err) => console.error('audits: could not sweep the last run:', err));
    g.__audits = { live: new Map(), queue: [], running: 0, ready };
  }
  return g.__audits;
}

function emit(live: Live, event: AuditEvent['event'], data: string) {
  const line = { seq: ++live.seq, event, data };
  if (event === 'progress') live.log = [...live.log.slice(1 - KEEP_LINES), line];
  for (const listener of live.listeners) listener(line);
}

/** The worker's own event stream, read here instead of by a browser. Its
 *  events are one `event:` line and one single-line JSON `data:` each. */
async function* events(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (event && data !== undefined) yield { event, data };
    }
  }
}

async function run(id: string) {
  const s = state();
  const live = s.live.get(id)!;
  s.running++;
  let outcome: { result: string } | { error: string } = { error: 'The engine stopped without a report.' };
  try {
    const db = await store();
    const row = (await getAudit(db, id))!;
    await startAudit(db, id);
    const search = new URLSearchParams(row.params);
    search.set('format', 'json');
    // The drafts are built from per-page data that is gone once the report is
    // written, so they are asked for on every run — the fixer reads them, and
    // the export buttons offer them.
    for (const draft of ['sitemap-out', 'llms-out', 'schema-out']) search.set(draft, '1');
    const res = await engine('stream', search);
    if (!res.ok || !res.body) {
      outcome = { error: await res.text() };
    } else {
      for await (const { event, data } of events(res.body)) {
        if (event === 'progress') emit(live, 'progress', data);
        // The id travels with the report, so the page can name it for exports.
        else if (event === 'done') outcome = { result: JSON.stringify({ ...JSON.parse(data), id }) };
        else if (event === 'failed') outcome = { error: JSON.parse(data) };
      }
    }
  } catch (err) {
    outcome = { error: `The audit stopped: ${(err as Error).message}` };
  } finally {
    // Stored before the live copy goes, so anyone arriving in between finds
    // one or the other and never neither. A store that is down costs the
    // stored copy, not the queue.
    await store()
      .then((db) => finishAudit(db, id, outcome))
      .catch((err) => console.error(`audits: ${id} was not stored:`, err));
    emit(live, 'result' in outcome ? 'done' : 'failed', 'result' in outcome ? outcome.result : JSON.stringify(outcome.error));
    s.live.delete(id);
    s.running--;
    pump();
  }
}

function pump() {
  const s = state();
  while (s.running < RUNNING && s.queue.length) void run(s.queue.shift()!);
}

/** Queue a crawl of `params` (the form's query string, `url` included). An
 *  error string when this address already has as many going as it may. */
export async function enqueue(params: URLSearchParams, ip: string): Promise<{ id: string } | { error: string }> {
  const s = state();
  await s.ready;
  const mine = [...s.live.values()].filter((l) => l.ip === ip).length;
  if (mine >= PER_ADDRESS) return { error: `You already have ${mine} audits going. Wait for one to finish.` };

  const id = randomUUID();
  // Counted against the address before the first await, so two requests at
  // once cannot both pass the check above.
  const live: Live = { ip, log: [], seq: 0, listeners: new Set() };
  s.live.set(id, live);
  try {
    await createAudit(await store(), { id, url: params.get('url') ?? '', params: params.toString() });
  } catch (err) {
    s.live.delete(id);
    throw err;
  }
  s.queue.push(id);
  if (s.running >= RUNNING) {
    emit(live, 'progress', JSON.stringify(`queued     ${s.queue.length - 1} ahead — starts when a crawl finishes`));
  }
  pump();
  return { id };
}

/** Take a crawl off the queue. One already running finishes regardless.
 *
 *  ponytail: the engine takes no abort signal, so a running crawl cannot be
 *  stopped — it keeps its slot until done. Thread an AbortSignal through
 *  audit() into Fetcher if abandoned crawls start crowding the queue. */
export async function cancel(id: string): Promise<void> {
  const s = state();
  const at = s.queue.indexOf(id);
  const live = s.live.get(id);
  if (at < 0 || !live) return;
  s.queue.splice(at, 1);
  await finishAudit(await store(), id, { error: 'Stopped.' });
  emit(live, 'failed', JSON.stringify('Stopped.'));
  s.live.delete(id);
}

export const known = async (id: string) => state().live.has(id) || (await getAudit(await store(), id)) !== null;

/** Follow one crawl: every line after `after`, then each new one as it comes,
 *  ending with `done` or `failed`. Returns the way to stop listening. */
export function watch(id: string, after: number, listener: Listener): () => void {
  const live = state().live.get(id);
  if (live) {
    for (const line of live.log) if (line.seq > after) listener(line);
    live.listeners.add(listener);
    return () => live.listeners.delete(listener);
  }
  // Already finished: the store has the last word.
  void store()
    .then((db) => getAudit(db, id))
    .catch(() => null)
    .then((row) => {
      if (row?.status === 'done' && row.result) listener({ seq: Number.MAX_SAFE_INTEGER, event: 'done', data: row.result });
      else listener({ seq: Number.MAX_SAFE_INTEGER, event: 'failed', data: JSON.stringify(row?.error ?? 'No such audit.') });
    });
  return () => {};
}

/** A finished report, parsed — for exports now, and for the fixer later. */
export async function report(id: string): Promise<Record<string, unknown> | null> {
  const row = await getAudit(await store(), id);
  return row?.status === 'done' && row.result ? JSON.parse(row.result) : null;
}
