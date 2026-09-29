// The one place this app writes to someone's repository — and it only ever
// writes a new branch and a pull request from it. Nothing here can touch the
// branch the pull request is against: a human merges, or nothing lands.
//
// The Git Data API rather than the contents API: one tree, one commit, one ref,
// however many files, so a fix is one commit and never half of one.

import { headers } from './github.ts';

const API = 'https://api.github.com';

export type Written = { ok: true; number: number; url: string } | { ok: false; reason: string };

type Change = { path: string; content: string };

/** Why GitHub said no, in terms of what to do about it. */
function reason(status: number, message: string, repo: string, step: string): string {
  if (status === 403 && /not accessible by integration/i.test(message)) {
    return `The GitHub App may not write to ${repo}. Give it "Contents" and "Pull requests": read & write in the app's settings, then accept the new permissions on GitHub.`;
  }
  if (status === 404) return `The GitHub App can no longer reach ${repo} — adjust its permissions on GitHub.`;
  if (status === 409) return `${repo} is empty, so there is nothing to branch from.`;
  return `GitHub answered ${status} ${step}${message ? `: ${message}` : ''}.`;
}

/** Commit `files` onto `sha` as `branch`, and open a pull request from it into
 *  `base`. Asking twice for the same branch moves that branch and returns the
 *  pull request already open from it, so a retry never opens a second one. */
export async function openPullRequest(o: {
  token: string;
  owner: string;
  name: string;
  base: string;
  sha: string;
  branch: string;
  files: Change[];
  title: string;
  body: string;
}): Promise<Written> {
  const repo = `${o.owner}/${o.name}`;
  const call = async (method: string, path: string, body?: object) => {
    const res = await fetch(`${API}/repos/${repo}${path}`, {
      method,
      headers: { ...headers(o.token), 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  };
  const fail = (r: { status: number; data: { message?: string } }, step: string): Written => ({
    ok: false,
    reason: reason(r.status, r.data.message ?? '', repo, step),
  });

  try {
    const tree = await call('POST', '/git/trees', {
      base_tree: o.sha,
      tree: o.files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
    });
    if (!tree.ok) return fail(tree, 'writing the files');

    const commit = await call('POST', '/git/commits', { message: o.title, tree: tree.data.sha, parents: [o.sha] });
    if (!commit.ok) return fail(commit, 'committing');

    let ref = await call('POST', '/git/refs', { ref: `refs/heads/${o.branch}`, sha: commit.data.sha });
    // The branch is this fix's own, named after it, so one already there is an
    // earlier try at this same fix and is safe to move.
    if (ref.status === 422) {
      ref = await call('PATCH', `/git/refs/heads/${o.branch}`, { sha: commit.data.sha, force: true });
    }
    if (!ref.ok) return fail(ref, 'creating the branch');

    const pr = await call('POST', '/pulls', { title: o.title, head: o.branch, base: o.base, body: o.body });
    if (pr.ok) return { ok: true, number: pr.data.number, url: pr.data.html_url };
    if (pr.status === 422) {
      const open = await call('GET', `/pulls?state=open&head=${encodeURIComponent(`${o.owner}:${o.branch}`)}`);
      const existing = Array.isArray(open.data) ? open.data[0] : null;
      if (existing) return { ok: true, number: existing.number, url: existing.html_url };
    }
    return fail(pr, 'opening the pull request');
  } catch (err) {
    return { ok: false, reason: `Could not reach GitHub: ${(err as Error).message}` };
  }
}

/** Whether a pull request is still open, was merged, or was closed without it. */
export async function pullState(
  token: string,
  repo: string,
  number: number,
): Promise<'open' | 'closed' | 'merged' | null> {
  const res = await fetch(`${API}/repos/${repo}/pulls/${number}`, { headers: headers(token), cache: 'no-store' }).catch(
    () => null,
  );
  if (!res?.ok) return null;
  const pr: { state: string; merged_at: string | null } = await res.json();
  return pr.merged_at ? 'merged' : pr.state === 'open' ? 'open' : 'closed';
}
