// Opening a fix's pull request, and what it says. The worker opens it at the
// end of a run (runner.ts); the web app opens it again when that failed
// (fixes.ts). Its own file so the web app's bundle never reaches the sandbox or
// the model loop. Plain Node imports, as in runner.ts.

import type { DatabaseSync } from 'node:sqlite';

import type { Report } from '../app/types.ts';
import { getAudit, type Check, type Job, type JobOutput, type PullRequest, type Repo } from './db.ts';
import { fixables } from './fixable.ts';
import { installationToken } from './github-app.ts';
import { openPullRequest } from './github-write.ts';

/** A finished audit's report, parsed. */
export function storedReport(db: DatabaseSync, id: string): Report | null {
  const row = getAudit(db, id);
  return row?.status === 'done' && row.result ? JSON.parse(row.result) : null;
}

/** A request's first line, cut to fit a title. */
const short = (request: string) => {
  const line = request.trim().split('\n')[0];
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
};

export const verdict = (c: Check) => (c.ok ? 'passed' : c.before === false ? 'failed, as it does without these changes' : 'failed');

function describe(out: JobOutput, kept: Report | null, repo: Repo, request?: string): { title: string; body: string } {
  const fixed = out.findings.filter((f) => f.status === 'fixed');
  const skipped = out.findings.filter((f) => f.status === 'skipped');
  const titles = new Map((kept ? fixables(kept) : []).map((f) => [f.id, f.title]));
  if (request) titles.set('request', `Requested: ${short(request)}`);
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
    ...(request ? ['', '### Requested', ...request.split('\n').map((line) => `> ${line}`)] : []),
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
  job: Pick<Job, 'id' | 'auditId' | 'createdAt' | 'input'> & { output: JobOutput },
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
    ...describe(job.output, storedReport(db, job.auditId), repo, job.input.request),
  });
  return written.ok ? { ok: true, pr: { number: written.number, url: written.url, branch, state: 'open' } } : written;
}
