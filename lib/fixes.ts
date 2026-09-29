import { randomUUID } from 'node:crypto';

import { report } from './audits';
import {
  abandonJobs,
  createJob,
  finishJob,
  getJob,
  logJob,
  repoById,
  repoJobs,
  runningJob,
  setJobPr,
  type Job,
  type JobOutput,
  type PullRequest,
  type Repo,
} from './db';
import { fixables } from './fixable';
import { aiConfigured, runFix } from './fixer';
import { readFile, snapshot } from './github';
import { installationToken } from './github-app';
import { openPullRequest, pullState } from './github-write';
import { store } from './store';
import type { Report } from '@/app/types';

// Fixes as jobs, the way crawls are (lib/audits.ts): asking starts one and
// answers with its id, the run carries on in this process, and the browser
// polls the row — so a reload, or a closed tab, loses nothing.
//
// ponytail: the run is this process's memory. A restart fails whatever was
// running (below); Phase B moves runs to a worker that polls the table.

const g = globalThis as typeof globalThis & { __fixesSwept?: boolean; __fixStops?: Map<string, AbortController> };
// The running fixes' Stop buttons, by job id.
const stops = (g.__fixStops ??= new Map());
function db() {
  if (!g.__fixesSwept) {
    abandonJobs(store(), 'The server restarted before this fix finished. Run it again.');
    g.__fixesSwept = true;
  }
  return store();
}

type Refusal = { error: string; status: number };

/** Start fixing `checks` from stored audit `auditId` in `repo`, as `userId`. */
export async function startFix(userId: number, repo: Repo, auditId: string, checks: string[]): Promise<{ job: Job } | Refusal> {
  if (!aiConfigured()) return { error: 'No model is set up: add AI_API_URL, AI_API_KEY and AI_MODEL to .env.local.', status: 503 };
  if (runningJob(db(), userId)) return { error: 'A fix is already running. Wait for it to finish.', status: 409 };
  if (!repo.installationId) return { error: 'Import this repository again through the GitHub App to fix it.', status: 422 };

  const kept = report(auditId) as Report | null;
  if (!kept) return { error: 'That report is gone — reports are kept for a week. Run the audit again.', status: 404 };
  const picked = fixables(kept).filter((f) => checks.includes(f.id));
  if (!picked.length) return { error: 'Pick at least one finding this can fix.', status: 400 };

  const token = await installationToken(repo.installationId);
  if (!token) return { error: `The GitHub App can no longer reach ${repo.owner}/${repo.name}.`, status: 422 };
  const snap = await snapshot(repo.owner, repo.name, repo.branch, token);
  if (!snap.ok) return { error: snap.reason, status: 502 };

  const id = randomUUID();
  try {
    createJob(db(), { id, userId, repoId: repo.id, auditId, input: { checks: picked.map((f) => f.id) } });
  } catch {
    return { error: 'A fix is already running. Wait for it to finish.', status: 409 };
  }

  const job = getJob(db(), id)!;
  const installation = repo.installationId;
  const log: string[] = [];
  const say = (line: string, tokens = job.tokens) => {
    log.push(line);
    logJob(db(), id, log, tokens);
  };
  const stop = new AbortController();
  stops.set(id, stop);
  void runFix({
    stop: stop.signal,
    origin: kept.meta.origin,
    repo: `${repo.owner}/${repo.name}`,
    snap: snap.value,
    checks: picked,
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
    onLog: (line, tokens) => {
      job.tokens = tokens;
      say(line, tokens);
    },
  })
    // The run ends in its pull request. Still `running` until it is open, so
    // the panel never shows a finished fix without one. A pull request that
    // will not open keeps the changes, and the panel offers to try again.
    .then(async (output) => {
      if (!output.files.length) return finishJob(db(), id, { output });
      say('opening the pull request');
      const opened = await pull({ ...job, output }, repo);
      if (opened.ok) setJobPr(db(), id, opened.pr);
      finishJob(db(), id, { output, ...(opened.ok ? {} : { error: opened.reason }) });
    })
    .catch((err: Error) => finishJob(db(), id, { error: stop.signal.aborted ? 'Stopped. Nothing was written to GitHub.' : err.message }))
    .finally(() => stops.delete(id));

  return { job };
}

/** The job, if it is `userId`'s. */
export function fixFor(userId: number, id: string): Job | null {
  const job = getJob(db(), id);
  return job?.userId === userId ? job : null;
}

/** Stop a running fix. The model's request in flight is cut; nothing it
 *  staged goes anywhere. */
export function stopFix(userId: number, id: string): Job | null {
  const job = fixFor(userId, id);
  if (job?.status !== 'running') return job;
  const stop = stops.get(id);
  // Running with no Stop to press: its process is gone, so say so now.
  if (stop) stop.abort();
  else finishJob(db(), id, { error: 'Stopped. Nothing was written to GitHub.' });
  return job;
}

/** A repository's recent fixes, with the state of every pull request that was
 *  open last time asked for again — merged or closed on GitHub since, it no
 *  longer covers its findings. */
export async function repoFixes(repo: Repo): Promise<Job[]> {
  const jobs = repoJobs(db(), repo.id);
  const open = jobs.filter((j) => j.pr?.state === 'open');
  const token = open.length && repo.installationId ? await installationToken(repo.installationId) : null;
  if (token) {
    await Promise.all(
      open.map(async (job) => {
        const state = await pullState(token, `${repo.owner}/${repo.name}`, job.pr!.number);
        if (state && state !== job.pr!.state) {
          job.pr = { ...job.pr!, state };
          setJobPr(db(), job.id, job.pr);
        }
      }),
    );
  }
  return jobs;
}

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
    '',
    'Written by a model from the audit and this repository, and not built or run. Review before merging.',
  ];
  return { title, body: body.join('\n') };
}

/** Commit a fix's changes on its own branch and open the pull request. */
async function pull(
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
    ...describe(job.output, report(job.auditId) as Report | null, repo),
  });
  return written.ok ? { ok: true, pr: { number: written.number, url: written.url, branch, state: 'open' } } : written;
}

/** Try again to open the pull request of a fix whose own attempt failed. A
 *  second ask returns the first. */
export async function openFixPr(userId: number, id: string): Promise<{ job: Job } | Refusal> {
  const job = fixFor(userId, id);
  if (!job) return { error: 'No such fix.', status: 404 };
  if (job.pr) return { job };
  if (job.status !== 'done' || !job.output?.files.length) return { error: 'This fix has nothing to commit.', status: 409 };
  const repo = repoById(db(), job.repoId);
  if (!repo) return { error: 'That repository is no longer linked.', status: 404 };
  const opened = await pull({ ...job, output: job.output }, repo);
  if (!opened.ok) return { error: opened.reason, status: 502 };
  setJobPr(db(), id, opened.pr);
  finishJob(db(), id, { output: job.output });
  return { job: getJob(db(), id)! };
}
