// The worker's half of a fix: run a claimed job to its pull request. Called by
// worker.ts, its own process, so a fix outlives a restart or a deploy of the
// web app and no request's time limit applies. Plain Node imports (`.ts`, no
// `@/`), because the worker is not bundled.

import type { DatabaseSync } from 'node:sqlite';

import type { Report } from '../app/types.ts';
import { finishJob, getAudit, logJob, repoById, setJobPr, type Check, type Job, type JobOutput, type PullRequest, type Repo } from './db.ts';
import { fixables } from './fixable.ts';
import { runFix } from './fixer.ts';
import { installationToken } from './github-app.ts';
import { readFile, snapshot, tarball } from './github.ts';
import { openPullRequest } from './github-write.ts';
import { broke, openBox, sandboxCli, type Box } from './sandbox.ts';

/** A finished audit's report, parsed. */
export function storedReport(db: DatabaseSync, id: string): Report | null {
  const row = getAudit(db, id);
  return row?.status === 'done' && row.result ? JSON.parse(row.result) : null;
}

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

const verdict = (c: Check) => (c.ok ? 'passed' : c.before === false ? 'failed, as it does without these changes' : 'failed');

function describe(out: JobOutput, kept: Report | null, repo: Repo): { title: string; body: string } {
  const fixed = out.findings.filter((f) => f.status === 'fixed');
  const skipped = out.findings.filter((f) => f.status === 'skipped');
  const titles = new Map((kept ? fixables(kept) : []).map((f) => [f.id, f.title]));
  const name = (id: string) => `**${titles.get(id) ?? id}** (\`${id}\`)`;
  const host = kept ? new URL(kept.meta.origin).host : `${repo.owner}/${repo.name}`;
  const title =
    fixed.length === 1 ? `SEO: ${titles.get(fixed[0].id) ?? fixed[0].id}` : `SEO: fix ${fixed.length} findings on ${host}`;
  const body = [
    out.summary,
    '',
    '### Fixed',
    ...(fixed.length ? fixed.map((f) => `- ${name(f.id)} — ${f.why}`) : ['- Nothing.']),
    ...(skipped.length ? ['', '### Skipped', ...skipped.map((f) => `- ${name(f.id)} — ${f.why}`)] : []),
    '',
    '### Files',
    ...out.files.map((f) => `- \`${f.path}\` ${f.before === null ? '(new)' : '(changed)'}`),
    '',
    kept?.score?.score != null
      ? `From an audit of ${kept.meta.origin} on ${kept.meta.date}, which scored ${kept.score.score} (${kept.score.grade}).`
      : `From an audit of ${host}.`,
    ...(out.checks?.length ? ['', '### Checked in a sandbox', ...out.checks.map((c) => `- \`${c.command}\` ${verdict(c)}`)] : []),
    '',
    `Written by a model from the audit and this repository${out.checks?.length ? '' : ', and not built or run'}. Review before merging.`,
  ];
  return { title, body: body.join('\n') };
}

/** Commit a fix's changes on its own branch and open the pull request. */
export async function pull(
  db: DatabaseSync,
  job: Pick<Job, 'id' | 'auditId' | 'createdAt'> & { output: JobOutput },
  repo: Repo,
): Promise<{ ok: true; pr: PullRequest } | { ok: false; reason: string }> {
  const token = repo.installationId && (await installationToken(repo.installationId));
  if (!token) return { ok: false, reason: `The GitHub App can no longer reach ${repo.owner}/${repo.name}.` };
  const branch = `seo-auditor/${job.createdAt.slice(0, 10)}-${job.id.slice(0, 8)}`;
  const written = await openPullRequest({
    token,
    owner: repo.owner,
    name: repo.name,
    base: job.output.base.branch,
    sha: job.output.base.sha,
    branch,
    files: job.output.files.map((f) => ({ path: f.path, content: f.after })),
    ...describe(job.output, storedReport(db, job.auditId), repo),
  });
  return written.ok ? { ok: true, pr: { number: written.number, url: written.url, branch, state: 'open' } } : written;
}
