// The worker's half of a fix: run a claimed job to its pull request. Called by
// worker.ts, its own process, so a fix outlives a restart or a deploy of the
// web app and no request's time limit applies. Plain Node imports (`.ts`, no
// `@/`), because the worker is not bundled.

import type { DatabaseSync } from 'node:sqlite';

import { finishJob, logJob, repoById, setJobPr, type Job } from './db.ts';
import { fixables } from './fixable.ts';
import { runFix } from './fixer.ts';
import { installationToken } from './github-app.ts';
import { readFile, snapshot, tarball } from './github.ts';
import { pull, storedReport, verdict } from './pull.ts';
import { broke, openBox, sandboxCli, type Box } from './sandbox.ts';

/** Run one claimed job until it ends. Never throws: the row has the outcome. */
export async function runJob(db: DatabaseSync, job: Job, stop: AbortSignal): Promise<void> {
  const log: string[] = [];
  let tokens = job.tokens;
  const say = (line: string) => {
    log.push(line);
    logJob(db, job.id, log, tokens);
  };
  let box: Box | null = null;
  try {
    const repo = repoById(db, job.repoId);
    if (!repo?.installationId) throw new Error('That repository is no longer linked through the GitHub App.');
    const kept = storedReport(db, job.auditId);
    if (!kept) throw new Error('That report is gone — reports are kept for a week. Run the audit again.');
    const installation = repo.installationId;
    const token = await installationToken(installation);
    if (!token) throw new Error(`The GitHub App can no longer reach ${repo.owner}/${repo.name}.`);
    const snap = await snapshot(repo.owner, repo.name, repo.branch, token);
    if (!snap.ok) throw new Error(snap.reason);
    const { sha, paths } = snap.value;

    if (sandboxCli()) {
      say('starting the sandbox');
      box = await openBox({
        id: job.id,
        tarball: await tarball(repo.owner, repo.name, sha, token),
        paths,
        pkg: paths.includes('package.json') ? await readFile(repo.owner, repo.name, sha, 'package.json', token) : null,
        signal: stop,
        say,
      });
    }

    const output = await runFix({
      stop,
      origin: kept.meta.origin,
      repo: `${repo.owner}/${repo.name}`,
      snap: snap.value,
      checks: fixables(kept).filter((f) => job.input.checks.includes(f.id)),
      request: job.input.request,
      drafts: {
        sitemapUrls: kept.sitemap?.urls,
        sitemapRefused: kept.sitemap?.refused,
        llms: kept.llms?.text,
        llmsRefused: kept.llms?.refused,
      },
      // Asked for each read: an installation token lasts an hour, and a run has
      // no set length. It is cached, so this costs nothing until it expires.
      read: async (path) =>
        readFile(repo.owner, repo.name, snap.value.sha, path, (await installationToken(installation)) ?? token),
      onLog: (line, t) => {
        tokens = t;
        say(line);
      },
      run: box?.run,
    });

    // The run ends in its pull request. Still `running` until it is open, so
    // the panel never shows a finished fix without one. A pull request that
    // will not open keeps the changes, and the panel offers to try again.
    if (!output.files.length) return finishJob(db, job.id, { output });

    // Proven by us, not by the model saying so. A check these changes broke
    // means no pull request; the panel shows why and can open it anyway.
    if (box) {
      say('checking the changes in the sandbox');
      output.checks = await box.verify(output.files);
      for (const c of output.checks) say(`${c.command}: ${verdict(c)}`);
      const broken = output.checks.filter(broke);
      if (broken.length) {
        return finishJob(db, job.id, {
          output,
          error: `${broken.map((c) => c.command).join(' and ')} failed with these changes, so no pull request was opened.`,
        });
      }
    }
    stop.throwIfAborted();
    say('opening the pull request');
    const opened = await pull(db, { ...job, output }, repo);
    if (opened.ok) setJobPr(db, job.id, opened.pr);
    finishJob(db, job.id, { output, ...(opened.ok ? {} : { error: opened.reason }) });
  } catch (err) {
    finishJob(db, job.id, { error: stop.aborted ? 'Stopped. Nothing was written to GitHub.' : (err as Error).message });
  } finally {
    await box?.close();
  }
}
