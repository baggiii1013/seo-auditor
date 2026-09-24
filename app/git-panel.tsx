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

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { StateDot } from './viz';
import type { Repo } from '@/lib/db';
import type { GitState } from '@/lib/git-state';
import type { FileState, Look, RepoChoice } from '@/lib/github';
import { siteKey } from '@/lib/site-key';

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

const connectButton =
  'shrink-0 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white shadow-sm transition duration-150 ease-out hover:bg-[#ef5314] active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100';

const action =
  'shrink-0 rounded-md border border-line bg-white/[0.06] px-2.5 py-1 text-xs font-medium text-ink/70 transition duration-150 ease-out hover:border-ink/25 hover:text-ink active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100';

export default function GitPanel({ origin, git }: { origin: string; git: GitState }) {
  const router = useRouter();
  // Seeded from the page, so drawing this costs no request. Kept in state so a
  // link or a connect shows at once; `router.refresh()` after each one brings
  // the page's copy up to date for the next audit.
  const [repo, setRepo] = useState<Repo | null>(git.links[siteKey(origin)] ?? null);
  const [account, setAccount] = useState(git.account);
  const [look, setLook] = useState<Look | null>(null);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [repos, setRepos] = useState<RepoChoice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = `/api/git?origin=${encodeURIComponent(origin)}`;

  // The only call this panel makes on its own: what is in a repository that is
  // already linked. No link, no request.
  const linkedId = repo?.id;
  useEffect(() => {
    if (!linkedId) return;
    let live = true;
    fetch(`/api/git?origin=${encodeURIComponent(origin)}`)
      .then((res) => res.json())
      .then((data: { look?: Look }) => live && setLook(data.look ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [origin, linkedId]);

  // Opening the importer fetches the list.
  useEffect(() => {
    if (!open || !account) return;
    let live = true;
    fetch('/api/git/repos')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `Listing failed (${res.status})`);
        if (live) setRepos(data.repos);
      })
      .catch((err) => live && setError((err as Error).message));
    return () => {
      live = false;
    };
  }, [open, account]);

  const send = async (init: RequestInit) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, init);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `GitHub link failed (${res.status})`);
      setRepo(data.repo);
      setLook(data.look ?? null);
      setOpen(false);
      setInput('');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const link = (full: string) =>
    send({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin, repo: full }),
    });

  // The Vercel flow: a popup to GitHub's consent screen, which reports back by
  // postMessage — the report stays on the page because the page never leaves.
  const connect = () => {
    setError(null);
    if (!git.canConnect) {
      setError('GitHub is not set up yet: add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to .env.local and restart.');
      return;
    }
    const popup = window.open('/api/git/connect', 'github-connect', 'width=600,height=720');
    if (!popup) return setError('The browser blocked the GitHub popup — allow popups for this site and try again.');
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.data?.type !== 'github-connect') return;
      window.removeEventListener('message', onMessage);
      popup?.close();
      if (!e.data.ok) return setError(e.data.message);
      setAccount({ login: e.data.message, via: 'oauth' });
      setOpen(true);
      router.refresh();
    };
    window.addEventListener('message', onMessage);
  };

  const disconnect = async () => {
    await fetch('/api/git/connect', { method: 'DELETE' });
    setAccount(null);
    setOpen(false);
    router.refresh();
  };

  const seen = look?.ok ? look.repo : null;

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
          {look && !look.ok && (
            <p className="mt-1.5 text-page-ink/70">{look.reason}</p>
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
      ) : open && account ? (
        <div className="enter-fade max-w-md">
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Search your repositories"
              aria-label="Search repositories"
              autoFocus
              className={field}
            />
            <button onClick={() => setOpen(false)} disabled={busy} className={action}>
              Cancel
            </button>
          </div>
          {!repos ? (
            !error && <p className="mt-1.5 text-page-ink/55">Loading repositories…</p>
          ) : (
            <ul className="mt-1.5 max-h-64 divide-y divide-line overflow-y-auto rounded-md border border-line">
              {repos
                .filter((r) => r.fullName.toLowerCase().includes(input.trim().toLowerCase()))
                .slice(0, 50)
                .map((r) => (
                  <li key={r.fullName} className="flex items-center gap-2 px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 truncate font-mono text-page-ink/80">{r.fullName}</span>
                    {r.private && <span className="t-eyebrow text-page-ink/55">Private</span>}
                    <button onClick={() => link(r.fullName)} disabled={busy} className={action}>
                      Import
                    </button>
                  </li>
                ))}
            </ul>
          )}
          {account.via === 'oauth' && (
            <p className="mt-1.5 text-page-ink/55">
              Connected as <span className="font-mono">{account.login}</span> ·{' '}
              <button onClick={disconnect} className="underline underline-offset-2 hover:text-brand">
                Disconnect
              </button>
            </p>
          )}
        </div>
      ) : account ? (
        <button onClick={() => setOpen(true)} className={connectButton}>
          <span aria-hidden>⎇ </span>Connect a repository
        </button>
      ) : (
        <button onClick={connect} className={connectButton}>
          <span aria-hidden>⎇ </span>Connect GitHub
        </button>
      )}

      {error && <p className="mt-1.5 text-page-ink/70">{error}</p>}
    </div>
  );
}
