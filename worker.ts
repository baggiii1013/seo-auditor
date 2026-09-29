// The job runner: `npm run worker`, beside `next dev` or `next start`. The web
// app only queues fixes in the store; this takes them, FIX_CONCURRENCY at a
// time, and runs each to its pull request (lib/runner.ts).
//
// ponytail: SQLite as the queue, polled every second, one worker per store.
// More than one host means a real queue (or Trigger.dev / Inngest) and claims
// with a lease.

import { libraryRoot } from './engine/src/library.mjs';
import { abandonJobs, claimJob, openDb, stopsAsked } from './lib/db.ts';
import { runJob } from './lib/runner.ts';
import { prepareSandbox, sandboxCli } from './lib/sandbox.ts';

const db = openDb(libraryRoot());
const CONCURRENCY = Number(process.env.FIX_CONCURRENCY) || 2;
const running = new Map<string, AbortController>();

// Whatever the last worker was running died with it. Queued jobs wait on.
const lost = abandonJobs(db, 'The worker restarted before this fix finished. Run it again.');
console.log(`worker: ${CONCURRENCY} at a time${lost ? `, ${lost} interrupted run(s) marked failed` : ''}`);

// With FIX_SANDBOX set every fix gets a container; without it none runs.
if (sandboxCli()) {
  console.log(`worker: preparing the ${sandboxCli()} sandbox (the first time takes a few minutes)`);
  await prepareSandbox();
  console.log('worker: sandbox ready');
} else {
  console.log('worker: no sandbox (FIX_SANDBOX=docker or podman), so nothing a fix writes is built or run');
}

function tick() {
  for (const id of stopsAsked(db)) running.get(id)?.abort();
  while (running.size < CONCURRENCY) {
    const job = claimJob(db);
    if (!job) break;
    const stop = new AbortController();
    running.set(job.id, stop);
    console.log(`worker: ${job.id} started`);
    void runJob(db, job, stop.signal).finally(() => {
      running.delete(job.id);
      console.log(`worker: ${job.id} ended`);
    });
  }
}

setInterval(tick, 1000);
tick();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    abandonJobs(db, 'The worker was shut down before this fix finished. Run it again.');
    process.exit(0);
  });
}
