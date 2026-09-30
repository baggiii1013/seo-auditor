import { randomUUID } from 'node:crypto';

import { report } from './audits';
import { activeJob, createJob, finishJob, getJob, repoById, repoJobs, setJobPr, stopJob, type Job, type Repo } from './db';
import { fixables } from './fixable';
import { fixReport } from './fix-report';
import { aiConfigured } from './fixer';
import { installationToken } from './github-app';
import { pullState } from './github-write';
import { pull } from './pull';
import { store } from './store';
import type { Report } from '@/app/types';

// Fixes as jobs. Asking queues one and answers with its id; the worker
// (worker.ts, `npm run worker`) runs it, and the browser polls the row — so a
// reload, a closed tab or a restart of this server loses nothing.

type Refusal = { error: string; status: number };

const MAX_REQUEST = 2000;

/** Queue a fix of `checks` from stored audit `auditId` in `repo`, plus
 *  `request` in the user's words, as `userId`. */
export function startFix(userId: number, repo: Repo, auditId: string, checks: string[], request = ''): { job: Job } | Refusal {
  if (!aiConfigured()) return { error: 'No model is set up: add AI_API_URL, AI_API_KEY and AI_MODEL to .env.local.', status: 503 };
  if (activeJob(store(), userId)) return { error: 'A fix is already running. Wait for it to finish.', status: 409 };
  if (!repo.installationId) return { error: 'Import this repository again through the GitHub App to fix it.', status: 422 };

  const kept = report(auditId) as Report | null;
  if (!kept) return { error: 'That report is gone — reports are kept for a week. Run the audit again.', status: 404 };
  const picked = fixables(kept).filter((f) => checks.includes(f.id));
  request = request.trim();
  if (!picked.length && !request) return { error: 'Pick a finding, or say what else to fix.', status: 400 };
  if (request.length > MAX_REQUEST) return { error: `Keep the request under ${MAX_REQUEST} characters.`, status: 400 };

  const id = randomUUID();
  try {
    createJob(store(), { id, userId, repoId: repo.id, auditId, input: { checks: picked.map((f) => f.id), ...(request ? { request } : {}) } });
  } catch {
    return { error: 'A fix is already running. Wait for it to finish.', status: 409 };
  }
  return { job: getJob(store(), id)! };
}

/** The job, if it is `userId`'s. */
export function fixFor(userId: number, id: string): Job | null {
  const job = getJob(store(), id);
  return job?.userId === userId ? job : null;
}

/** Stop a fix. The model's request in flight is cut; nothing it staged goes
 *  anywhere. */
export function stopFix(userId: number, id: string): Job | null {
  const job = fixFor(userId, id);
  if (job) stopJob(store(), id, 'Stopped. Nothing was written to GitHub.');
  return job;
}

/** A repository's recent fixes, with the state of every pull request that was
 *  open last time asked for again — merged or closed on GitHub since, it no
 *  longer covers its findings. */
export async function repoFixes(repo: Repo): Promise<Job[]> {
  const jobs = repoJobs(store(), repo.id);
  const open = jobs.filter((j) => j.pr?.state === 'open');
  const token = open.length && repo.installationId ? await installationToken(repo.installationId) : null;
  if (token) {
    await Promise.all(
      open.map(async (job) => {
        const state = await pullState(token, `${repo.owner}/${repo.name}`, job.pr!.number);
        if (state && state !== job.pr!.state) {
          job.pr = { ...job.pr!, state };
          setJobPr(store(), job.id, job.pr);
        }
      }),
    );
  }
  return jobs;
}

/** Try again to open the pull request of a fix whose own attempt failed. A
 *  second ask returns the first. */
export async function openFixPr(userId: number, id: string): Promise<{ job: Job } | Refusal> {
  const job = fixFor(userId, id);
  if (!job) return { error: 'No such fix.', status: 404 };
  if (job.pr) return { job };
  if (job.status !== 'done' || !job.output?.files.length) return { error: 'This fix has nothing to commit.', status: 409 };
  const repo = repoById(store(), job.repoId);
  if (!repo) return { error: 'That repository is no longer linked.', status: 404 };
  const opened = await pull(store(), { ...job, output: job.output }, repo);
  if (!opened.ok) return { error: opened.reason, status: 502 };
  setJobPr(store(), id, opened.pr);
  finishJob(store(), id, { output: job.output });
  return { job: getJob(store(), id)! };
}

/** A finished fix as an Excel workbook (lib/fix-report.ts). */
export function fixWorkbook(userId: number, id: string): { name: string; file: Buffer } | Refusal {
  const job = fixFor(userId, id);
  if (!job) return { error: 'No such fix.', status: 404 };
  if (job.status !== 'done') return { error: 'This fix has not finished.', status: 409 };
  return fixReport(job, report(job.auditId) as Report | null, repoById(store(), job.repoId));
}
