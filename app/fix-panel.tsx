'use client';

// Fixing this report's findings in the linked repository — inside the
// Repository card, because the repository is what it changes.
//
// Three screens: pick findings, watch the model work, and what it did — the
// pull request it opened, with the same diff drawn here. The run ends in that
// pull request on a branch of its own (lib/github-write.ts): reviewing and
// merging it on GitHub is the step a person takes.

import { GitPullRequest } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { LEVELS } from './types';
import { StateDot } from './viz';
import type { Job, PullRequest } from '@/lib/db';
import { diffLines } from '@/lib/diff';
import type { Fixable } from '@/lib/fixable';

const primary =
  'shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm transition duration-150 ease-out hover:bg-[#ef5314] active:scale-[0.98] disabled:opacity-35 disabled:active:scale-100';
const ghost =
  'shrink-0 rounded-lg border border-line bg-white/[0.06] px-4 py-2 text-sm font-medium text-ink/70 transition duration-150 ease-out hover:border-ink/25 hover:text-ink active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100';
const link =
  'font-medium text-ink underline decoration-ink/25 underline-offset-2 transition-colors duration-150 ease-out hover:text-brand';

/** The body of an error answer, JSON or the rate limiter's plain text. */
async function failure(res: Response): Promise<string> {
  const text = await res.text();
  try {
    return JSON.parse(text).error ?? text;
  } catch {
    return text || `The server answered ${res.status}.`;
  }
}

function Diff({ file }: { file: NonNullable<Job['output']>['files'][number] }) {
  const lines = diffLines(file.before ?? '', file.after);
  return (
    <details open className="overflow-hidden rounded-xl border border-line">
      <summary className="flex cursor-pointer items-center gap-2 bg-canvas px-4 py-2 text-sm">
        <span className="min-w-0 flex-1 truncate font-mono text-ink/80">{file.path}</span>
        <span className="t-eyebrow text-ink/50">{file.before === null ? 'New file' : 'Changed'}</span>
      </summary>
      <pre className="max-h-96 overflow-auto border-t border-line py-2 font-mono text-xs leading-relaxed">
        {lines.map((line, i) =>
          line.op === '…' ? (
            <div key={i} className="px-4 text-ink/40">
              ⋯ {line.count} unchanged {line.count === 1 ? 'line' : 'lines'}
            </div>
          ) : (
            <div
              key={i}
              className={`px-4 whitespace-pre ${
                line.op === '+' ? 'bg-emerald-500/12 text-ink/85' : line.op === '-' ? 'bg-rose-500/12 text-ink/60' : 'text-ink/60'
              }`}
            >
              <span aria-hidden className="mr-3 select-none text-ink/35">
                {line.op}
              </span>
              {line.text}
            </div>
          ),
        )}
      </pre>
    </details>
  );
}

/** Not finished: waiting for the worker, or with it. */
const active = (job: Job) => job.status === 'queued' || job.status === 'running';

/** What the run has cost so far, input and output apart — they are priced
 *  apart, and input is most of it. */
function Tokens({ job }: { job: Job }) {
  return (
    <>
      {job.tokens.in.toLocaleString()} tokens in · {job.tokens.out.toLocaleString()} out
    </>
  );
}

export default function FixPanel({
  origin,
  auditId,
  items,
  canFix,
}: {
  origin: string;
  auditId: string;
  items: Fixable[];
  canFix: boolean;
}) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [picked, setPicked] = useState(() => new Set(items.filter((i) => i.kind === 'file').map((i) => i.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What is already on its way: this repository's fixes, the one still
  // running (or finished for this report and not yet decided on) shown again
  // after a reload, and every open pull request that covers a finding.
  useEffect(() => {
    let live = true;
    fetch(`/api/fixes?origin=${encodeURIComponent(origin)}`)
      .then((res) => res.json())
      .then((data: { jobs: Job[] }) => {
        if (!live) return;
        setJobs(data.jobs);
        const last = data.jobs[0];
        if (last && (active(last) || last.auditId === auditId)) setJob(last);
      })
      .catch(() => live && setJobs([]));
    return () => {
      live = false;
    };
  }, [origin, auditId]);

  // Polled while the model works. A second a step is about as fast as it goes.
  const runningId = job && active(job) ? job.id : null;
  useEffect(() => {
    if (!runningId) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/fixes/${runningId}`).catch(() => null);
      if (!res?.ok) return;
      const { job: next }: { job: Job } = await res.json();
      setJob(next);
      if (!active(next)) setJobs((all) => [next, ...(all ?? []).filter((j) => j.id !== next.id)]);
    }, 1500);
    return () => clearInterval(timer);
  }, [runningId]);

  // Findings already fixed in a pull request still open, grouped by it:
  // fixing them again would only open a second one. The report still shows
  // them until that is merged, deployed and audited again.
  const covered = new Set<string>();
  const pending: { job: Job; pr: PullRequest; items: Fixable[] }[] = [];
  for (const j of jobs ?? []) {
    if (j.pr?.state !== 'open') continue;
    const fixed = new Set(j.output?.findings.filter((f) => f.status === 'fixed').map((f) => f.id));
    const mine = items.filter((i) => fixed.has(i.id) && !covered.has(i.id));
    for (const i of mine) covered.add(i.id);
    if (mine.length) pending.push({ job: j, pr: j.pr, items: mine });
  }
  const free = items.filter((i) => !covered.has(i.id));

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/fixes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ origin, audit: auditId, checks: [...picked].filter((id) => !covered.has(id)) }),
      });
      if (!res.ok) throw new Error(await failure(res));
      setJob((await res.json()).job);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const open = async () => {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/fixes/${job.id}/pull`, { method: 'POST' });
      if (!res.ok) throw new Error(await failure(res));
      const { job: next }: { job: Job } = await res.json();
      setJob(next);
      setJobs((all) => [next, ...(all ?? []).filter((j) => j.id !== next.id)]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const title = (id: string) => items.find((i) => i.id === id)?.title ?? id;
  const back = () => {
    setJob(null);
    setError(null);
  };

  let caption: string;
  let body: ReactNode = null;
  let actions: ReactNode = null;

  if (!canFix) {
    caption = 'Set AI_API_URL, AI_API_KEY and AI_MODEL in .env.local to have a model fix these in a pull request.';
  } else if (job?.status === 'queued') {
    caption = 'Waiting for the worker to pick this up. If it stays here, the worker is not running: start it with npm run worker.';
    actions = (
      <button onClick={() => fetch(`/api/fixes/${job.id}`, { method: 'DELETE' })} className={ghost}>
        Cancel
      </button>
    );
  } else if (job?.status === 'running') {
    caption =
      'The model is reading the repository and making the changes. When it finishes, it opens a pull request on a new branch.';
    actions = (
      <button
        onClick={() => {
          setBusy(true);
          fetch(`/api/fixes/${job.id}`, { method: 'DELETE' }).finally(() => setBusy(false));
        }}
        disabled={busy}
        className={ghost}
      >
        {busy ? 'Stopping…' : 'Stop'}
      </button>
    );
    body = (
      <div className="mt-4 rounded-xl border border-line bg-canvas px-4 py-3">
        <ol className="space-y-1 font-mono text-xs text-ink/60">
          {job.log.length === 0 && <li>Starting…</li>}
          {job.log.slice(-8).map((line, i) => (
            <li key={job.log.length - 8 + i} className="enter-fade truncate">
              {line}
            </li>
          ))}
        </ol>
        <p className="t-num mt-3 text-xs tabular-nums text-ink/45">
          {job.log.length} {job.log.length === 1 ? 'step' : 'steps'} · <Tokens job={job} />
        </p>
      </div>
    );
  } else if (job?.status === 'failed') {
    caption = 'The fix stopped before it finished. Nothing was written to GitHub.';
    body = (
      <>
        <p className="mt-4 text-sm text-ink/70">{job.error}</p>
        <p className="t-num mt-2 text-xs tabular-nums text-ink/45">
          <Tokens job={job} />
        </p>
      </>
    );
    actions = (
      <button onClick={back} className={ghost}>
        Back
      </button>
    );
  } else if (job?.output) {
    const out = job.output;
    // A check that fails with the changes and passed without them held the
    // pull request back (lib/sandbox.ts, `broke`).
    const broken = out.checks?.some((c) => !c.ok && c.before !== false);
    caption = job.pr
      ? 'Opened on a new branch — review and merge it on GitHub. The next audit after it is deployed shows what it changed.'
      : broken
        ? 'A check failed with these changes, so the pull request was not opened. Nothing reached your default branch.'
        : out.files.length
          ? 'The changes are ready, but the pull request did not open. Nothing reached your default branch.'
          : 'The model changed nothing, so there is no pull request. Its reasons are below.';
    body = (
      <div className="mt-4 space-y-4">
        {job.error && <p className="text-sm text-ink/70">{job.error}</p>}
        {out.summary && <p className="max-w-3xl text-sm leading-relaxed text-ink/75">{out.summary}</p>}
        <p className="t-num text-xs tabular-nums text-ink/45">
          <Tokens job={job} />
        </p>
        <ul className="divide-y divide-line/60 rounded-xl border border-line">
          {out.findings.map((f) => (
            <li key={f.id} className="flex items-start gap-3 px-4 py-2.5">
              <span className="mt-0.5">
                <StateDot state={f.status === 'fixed' ? 'passed' : 'skipped'} label={f.status === 'fixed' ? 'Fixed' : 'Skipped'} />
              </span>
              <div className="min-w-0 flex-1">
                <span className="text-sm text-ink/80">{title(f.id)}</span>
                <p className="mt-0.5 text-xs text-ink/50">{f.why}</p>
              </div>
              <span className="t-eyebrow shrink-0 pt-1 text-ink/50">{f.status}</span>
            </li>
          ))}
        </ul>
        {out.checks?.length ? (
          <ul className="divide-y divide-line/60 rounded-xl border border-line">
            {out.checks.map((c) => {
              const said = c.ok ? 'passed' : c.before === false ? 'fails without these changes too' : 'failed';
              return (
                <li key={c.command} className="px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <StateDot state={c.ok ? 'passed' : c.before === false ? 'skipped' : 'failed'} label={said} />
                    <code className="min-w-0 flex-1 truncate text-sm text-ink/80">{c.command}</code>
                    <span className="shrink-0 text-xs text-ink/50">{said}</span>
                  </div>
                  {!c.ok && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-ink/50">Output</summary>
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-ink/70">{c.tail}</pre>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
        {out.files.map((file) => (
          <Diff key={file.path} file={file} />
        ))}
      </div>
    );
    actions = (
      <>
        <button onClick={back} disabled={busy} className={ghost}>
          {job.pr ? 'Fix more' : out.files.length ? 'Discard' : 'Back'}
        </button>
        {job.pr ? (
          <a href={job.pr.url} target="_blank" rel="noreferrer" className={primary}>
            Pull request #{job.pr.number} →
          </a>
        ) : (
          out.files.length > 0 && (
            <button onClick={open} disabled={busy} className={primary}>
              {busy ? 'Opening…' : broken ? 'Open it anyway' : 'Try again'}
            </button>
          )
        )}
      </>
    );
  } else if (!items.length) {
    caption = 'Nothing in this report is something a model can fix from the source alone.';
  } else {
    const inPrs = items.length - free.length;
    caption = !free.length
      ? `Everything here is already fixed in an open pull request. Merge ${pending.length === 1 ? 'it' : 'them'} on GitHub, deploy, and audit again to see the findings pass.`
      : inPrs
        ? `${inPrs} ${inPrs === 1 ? 'finding is' : 'findings are'} already fixed in an open pull request, waiting for review. Pick from the rest: a model reads the repository and opens a new pull request for them.`
        : 'Pick what to fix. A model reads the repository, makes the changes, and opens a pull request on a new branch for you to review and merge.';
    body = (
      <>
        {pending.map(({ job: j, pr, items: its }) => (
          <section key={pr.number} className="mt-4 overflow-hidden rounded-xl border border-viz-good/30">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-viz-good/10 px-4 py-2.5">
              <GitPullRequest className="size-4 shrink-0 text-viz-good" aria-hidden />
              <span className="text-sm font-medium text-ink/90">Pull request #{pr.number}</span>
              <span className="t-eyebrow rounded-full bg-viz-good/20 px-2 py-0.5 text-viz-good">Open</span>
              <span className="text-xs text-ink/50">
                opened {new Date(j.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · waiting
                for review
              </span>
              <a href={pr.url} target="_blank" rel="noreferrer" className={`ml-auto text-sm ${link}`}>
                Review on GitHub →
              </a>
            </header>
            <ul className="divide-y divide-line/60 border-t border-viz-good/20">
              {its.map((item) => (
                <li key={item.id} className="flex items-center gap-3 px-4 py-2">
                  <StateDot state="passed" label="Fixed in this pull request" />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink/60">{item.title}</span>
                  <code className="rounded bg-ink/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-ink/40">{item.id}</code>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {free.length > 0 && pending.length > 0 && <h5 className="t-eyebrow mt-6 text-ink/45">Not fixed yet</h5>}
        {free.length > 0 && (
          <ul className={`${pending.length ? 'mt-2' : 'mt-4'} divide-y divide-line/60 rounded-xl border border-line`}>
            {free.map((item) => (
              <li key={item.id}>
                <label className="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-ink/[0.02]">
                  <input
                    type="checkbox"
                    checked={picked.has(item.id)}
                    onChange={(e) =>
                      setPicked((now) => {
                        const next = new Set(now);
                        if (e.target.checked) next.add(item.id);
                        else next.delete(item.id);
                        return next;
                      })
                    }
                    className="mt-1 size-4 shrink-0 accent-[var(--color-brand)]"
                  />
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${LEVELS[item.level].dot}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-sm text-ink/80">{item.title}</span>
                      <code className="rounded bg-ink/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-ink/45">{item.id}</code>
                    </span>
                    <span className="mt-0.5 block text-xs text-ink/50">
                      {item.kind === 'file'
                        ? 'A file the site does not serve'
                        : `On ${item.pages.length} ${item.pages.length === 1 ? 'page' : 'pages'}`}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </>
    );
    const count = [...picked].filter((id) => !covered.has(id)).length;
    actions = free.length > 0 && (
      <button onClick={start} disabled={busy || !count || jobs === null} className={primary}>
        {busy ? 'Starting…' : count ? `Fix ${count} with AI` : 'Fix with AI'}
      </button>
    );
  }

  return (
    <div className="mt-6 border-t border-line pt-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-xl">
          <h4 className="t-eyebrow text-ink/45">Fix with AI</h4>
          <p className="mt-2 text-sm leading-relaxed text-ink/55">{caption}</p>
        </div>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </div>
      {body}
      {error && <p className="mt-3 text-sm text-ink/70">{error}</p>}
    </div>
  );
}
