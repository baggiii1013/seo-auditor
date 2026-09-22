'use client';

// The repository behind the site, on the report that audits it.
//
// Read-only. It answers one question the report could not answer before —
// "is the thing I am being told to add already in the repo?" — and it answers
// it in the report's own terms: a present file, a missing file, and a file we
// could not tell about are three states, not two.
//
// It sits in the report header rather than on a card of its own, because it is
// the same kind of sentence as "40 pages crawled · 1.2s": context for the
// numbers below, not a finding among them.

import { useEffect, useState } from 'react';

import { StateDot } from './viz';
import type { Repo } from '@/lib/db';
import type { FileState, Look } from '@/lib/github';

type Payload = { repo: Repo | null; look?: Look };

/** present/missing/unknown drawn in the same three marks as
 *  passed/failed/not-checked. The same alphabet the rest of the report is
 *  written in, with the nouns corrected. */
const DOT: Record<FileState, { state: 'passed' | 'failed' | 'skipped'; label: string }> = {
  present: { state: 'passed', label: 'In the repository' },
  missing: { state: 'failed', label: 'Not in the repository' },
  unknown: { state: 'skipped', label: 'Could not tell' },
};

const field =
  'min-w-0 flex-1 rounded-md border border-line bg-white/[0.06] px-2.5 py-1 font-mono text-xs text-ink outline-none transition duration-150 ease-out placeholder:text-ink/45 focus:border-brand focus:ring-2 focus:ring-brand/15';

const action =
  'shrink-0 rounded-md border border-line bg-white/[0.06] px-2.5 py-1 text-xs font-medium text-ink/70 transition duration-150 ease-out hover:border-ink/25 hover:text-ink active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100';

export default function GitPanel({ origin }: { origin: string }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = `/api/git?origin=${encodeURIComponent(origin)}`;

  useEffect(() => {
    // `live` rather than an AbortController: the request is cheap and the only
    // thing worth preventing is a stale answer landing in state after the
    // origin has changed underneath it.
    let live = true;
    fetch(`/api/git?origin=${encodeURIComponent(origin)}`)
      .then((res) => res.json())
      .then((data: Payload) => live && setPayload(data))
      .catch(() => live && setPayload({ repo: null }));
    return () => {
      live = false;
    };
  }, [origin]);

  const send = async (init: RequestInit) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, init);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `GitHub link failed (${res.status})`);
      setPayload(data);
      setOpen(false);
      setInput('');
      setBranch('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const link = () =>
    send({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin, repo: input, branch }),
    });

  // Nothing at all until the answer is in. A control that renders empty and
  // then fills is a line of the header changing height after the page settles.
  if (!payload) return null;

  const repo = payload.repo;
  const seen = payload.look?.ok ? payload.look.repo : null;

  return (
    <div className="enter-fade mt-2 text-xs">
      {repo ? (
        <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-page-ink/70">
            <a
              href={seen?.url ?? `https://github.com/${repo.owner}/${repo.name}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono underline decoration-page-ink/25 underline-offset-2 transition-colors duration-150 ease-out hover:text-brand"
            >
              <span aria-hidden>⎇ </span>
              {repo.owner}/{repo.name}
            </a>
            {seen && <span className="font-mono text-page-ink/55">@ {seen.branch}</span>}
            {seen?.private && <span className="t-eyebrow text-page-ink/55">Private</span>}
            {seen?.commit && (
              <span className="min-w-0 truncate text-page-ink/55">
                ·{' '}
                <a
                  href={seen.commit.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono transition-colors duration-150 ease-out hover:text-brand"
                >
                  {seen.commit.sha}
                </a>{' '}
                {seen.commit.message}
              </span>
            )}
            <button onClick={() => send({ method: 'DELETE' })} disabled={busy} className={`${action} ml-1`}>
              Unlink
            </button>
          </div>

          {/* The reason, not a shrug. A panel that fails silently here is a
              reader concluding the repository is empty. */}
          {payload.look && !payload.look.ok && (
            <p className="mt-1.5 text-page-ink/70">{payload.look.reason}</p>
          )}

          {seen && (
            <ul className="mt-1.5 space-y-1">
              {seen.files.map((file) => (
                <li key={file.name} className="flex items-start gap-2">
                  <span className="mt-px">
                    <StateDot state={DOT[file.state].state} label={DOT[file.state].label} />
                  </span>
                  <span className="font-mono text-page-ink/70">{file.path ?? file.name}</span>
                  {file.state === 'missing' && <span className="text-page-ink/55">not in the repo</span>}
                  {file.why && <span className="min-w-0 text-page-ink/55">{file.why}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : open ? (
        <div className="enter-fade flex flex-wrap items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && input.trim() && !busy && link()}
            placeholder="owner/name"
            aria-label="Repository"
            autoFocus
            className={field}
          />
          <input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && input.trim() && !busy && link()}
            placeholder="branch (optional)"
            aria-label="Branch"
            className={`${field} max-w-40`}
          />
          <button onClick={link} disabled={busy || !input.trim()} className={action}>
            {busy ? 'Linking…' : 'Link'}
          </button>
          <button onClick={() => setOpen(false)} disabled={busy} className={action}>
            Cancel
          </button>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className={`${action} border-dashed`}>
          <span aria-hidden>⎇ </span>Link a repository
        </button>
      )}

      {error && <p className="mt-1.5 text-page-ink/70">{error}</p>}
    </div>
  );
}
