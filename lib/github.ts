// Reading a linked repository. Read-only, and deliberately so: nothing in this
// file writes, opens a pull request, or needs a token with a write scope.
//
// `fetch` against the REST API rather than a client library — three endpoints,
// no pagination, no auth flow. The engine next door is zero-dependency for
// reasons that apply just as well on this side of the wall.
//
// The one rule that shapes the whole file is the engine's: **a missing result
// must not read like a passing one.** GitHub returns the repository tree
// truncated when it is large, and a file absent from a truncated tree has not
// been shown to be absent from the repository. Those come back as `unknown`
// with the reason attached, never as `missing`.

export type FileState = 'present' | 'missing' | 'unknown';

export type TrackedFile = {
  /** The filename looked for, wherever in the tree it lives. */
  name: string;
  state: FileState;
  /** Where it turned out to be. Only on `present`. */
  path?: string;
  /** Why we could not tell. Only on `unknown`. */
  why?: string;
};

export type RepoLook = {
  owner: string;
  name: string;
  /** The branch actually read — the linked one, or the repo's default. */
  branch: string;
  url: string;
  private: boolean;
  commit: { sha: string; message: string; date: string; url: string } | null;
  files: TrackedFile[];
};

export type Look = { ok: true; repo: RepoLook } | { ok: false; reason: string };

/** The files an SEO audit cares whether the repository actually contains. The
 *  first two are checks the engine runs against the live site; the third is one
 *  of the three documents this report generates for you to add. */
const LOOK_FOR = ['robots.txt', 'sitemap.xml', 'llms.txt'];

/** How far from the repository root one of those can be and still plausibly be
 *  the file the site serves. The root itself, or one directory down — which is
 *  `public/`, `static/`, `www/`, `app/` and every other name a framework gives
 *  its web root, without this file having to know all of them. */
const WEB_ROOT_DEPTH = 1;

/** Source files that make one of the tracked files at build or request time,
 *  so a repository with one *has* the file even though no path in the tree is
 *  called `robots.txt`. Anchored at the repository root, or one app down in a
 *  monorepo (`apps/web/…`, `packages/site/…`).
 *
 *  ponytail: file names only — anything switched on in a config file
 *  (`@astrojs/sitemap`, `@nuxtjs/sitemap`, gatsby-plugin-sitemap, Hugo's
 *  built-in sitemap) needs the config read, and reads as missing until then. */
const CODE = '(js|jsx|ts|tsx|mjs|cjs)';

function generators(name: string): RegExp {
  const file = name.replace('.', '\\.');
  const [stem, ext] = name.split('.');
  const shapes = [
    `(src/)?app/${file}/route\\.${CODE}`, // Next.js route handler
    `(src/)?pages/${file}\\.${CODE}`, // Next.js pages router, Astro endpoint
    `src/routes/${file}/\\+server\\.${CODE}`, // SvelteKit
    `app/routes/(${stem}\\[\\.\\]${ext}|\\[${file}\\])\\.${CODE}`, // Remix, React Router
    `server/routes/${file}\\.${CODE}`, // Nuxt, Nitro
    `layouts/(_default/)?${file}`, // Hugo template
  ];
  // Next.js metadata routes exist for these two and not for llms.txt.
  if (name !== 'llms.txt') shapes.push(`(src/)?app/${stem}\\.${CODE}`);
  // next-sitemap always writes a sitemap; its robots.txt is opt-in, so no.
  if (name === 'sitemap.xml') shapes.push(`next-sitemap\\.config\\.${CODE}`);
  return new RegExp(`^((apps|packages)/[^/]+/)?(${shapes.join('|')})$`);
}

const GENERATED = Object.fromEntries(LOOK_FOR.map((name) => [name, generators(name)]));

const API = 'https://api.github.com';

/** `owner` and `name` are interpolated into an API path, so this is the trust
 *  boundary: anything outside GitHub's own charset for them is rejected here
 *  rather than escaped later. */
const REPO_PART = /^[A-Za-z0-9._-]+$/;

/** Dots are legal in a repository name — `acme/.github` is a real repository —
 *  but a segment that is *only* dots is `.` or `..`, which climbs the API path
 *  instead of naming anything. The charset alone let that through. */
const DOTS_ONLY = /^\.+$/;

const namePart = (part: string) => REPO_PART.test(part) && !DOTS_ONLY.test(part);

/** Accept what is actually on someone's clipboard — a browser URL, an ssh
 *  remote, or the `owner/name` GitHub prints everywhere. `null` when it is not
 *  any of those. */
export function parseRepo(input: string): { owner: string; name: string } | null {
  const tail = input
    .trim()
    .replace(/\.git$/i, '')
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/^\/+|\/+$/g, '');

  const parts = tail.split('/');
  if (parts.length !== 2) return null;

  const [owner, name] = parts;
  if (!namePart(owner) || !namePart(name)) return null;
  return { owner, name };
}

/** A token is optional and never required for a public repository. Without one
 *  GitHub allows sixty requests an hour per IP and cannot see a private repo;
 *  with one, five thousand. Read scope is all this file can use.
 *
 *  The connected account's OAuth token wins; `GITHUB_TOKEN` is the fallback for
 *  an operator who would rather paste a personal access token than register an
 *  OAuth app. */
export const envToken = () => process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;

export function headers(token: string | null): Record<string, string> {
  const base: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'seo-auditor',
  };
  if (token) base.authorization = `Bearer ${token}`;
  return base;
}

const get = (path: string, token: string | null) =>
  fetch(`${API}${path}`, { headers: headers(token), cache: 'no-store' });

/** The rate-limit message, with the reset time GitHub sends and the way out. */
function throttled(res: Response, token: string | null): string {
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  const when = Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toLocaleTimeString() : null;
  return [
    'GitHub is rate-limiting this address',
    when ? ` until ${when}` : '',
    token ? '.' : ' — connect GitHub to raise the limit from 60 requests an hour to 5,000.',
  ].join('');
}

// A look costs three requests and an unauthenticated caller gets sixty an hour.
// The report re-mounts on every filter keystroke and on every dev reload, so
// the same look is asked for far more often than its answer changes. A minute
// is long enough to stop the bleeding and short enough that a push you just
// made shows up while you are still looking at the page.
//
// ponytail: a Map that only evicts on read. Fine for one operator and a handful
// of repositories; swap for an LRU the day this serves more than that.
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; look: Look }>();

/** What the linked repository looks like right now. */
export async function look(
  owner: string,
  name: string,
  branch: string | null,
  token: string | null,
): Promise<Look> {
  if (!namePart(owner) || !namePart(name)) {
    return { ok: false, reason: `${owner}/${name} is not a repository name.` };
  }

  // The token is in the key: a look taken before connecting cannot see the
  // private repository a look taken after it can.
  const key = `${owner}/${name}@${branch ?? ''}#${token ?? ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.look;

  const look = await read(owner, name, branch, token);
  cache.set(key, { at: Date.now(), look });
  return look;
}

async function read(owner: string, name: string, branch: string | null, token: string | null): Promise<Look> {
  let repo: { default_branch?: string; private?: boolean; html_url?: string };
  try {
    const res = await get(`/repos/${owner}/${name}`, token);
    if (res.status === 404) {
      return {
        ok: false,
        reason: `No repository at ${owner}/${name} — or it is private, and the connected GitHub account cannot read it.`,
      };
    }
    if (res.status === 403 || res.status === 429) return { ok: false, reason: throttled(res, token) };
    if (!res.ok) return { ok: false, reason: `GitHub answered ${res.status} for ${owner}/${name}.` };
    repo = await res.json();
  } catch (err) {
    return { ok: false, reason: `Could not reach GitHub: ${(err as Error).message}` };
  }

  const ref = branch || repo.default_branch || 'main';

  const [commitRes, treeRes] = await Promise.all([
    get(`/repos/${owner}/${name}/commits?sha=${encodeURIComponent(ref)}&per_page=1`, token).catch(() => null),
    get(`/repos/${owner}/${name}/git/trees/${encodeURIComponent(ref)}?recursive=1`, token).catch(() => null),
  ]);

  return {
    ok: true,
    repo: {
      owner,
      name,
      branch: ref,
      url: repo.html_url ?? `https://github.com/${owner}/${name}`,
      private: Boolean(repo.private),
      commit: await lastCommit(commitRes),
      files: await tracked(treeRes, ref, token),
    },
  };
}

async function lastCommit(res: Response | null): Promise<RepoLook['commit']> {
  if (!res?.ok) return null;
  try {
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row?.sha) return null;
    return {
      sha: String(row.sha).slice(0, 7),
      // The subject line. A commit body in a one-line summary is a commit body
      // pushing the rest of the header off the screen.
      message: String(row.commit?.message ?? '').split('\n')[0],
      date: String(row.commit?.author?.date ?? row.commit?.committer?.date ?? ''),
      url: String(row.html_url ?? ''),
    };
  } catch {
    return null;
  }
}

async function tracked(res: Response | null, ref: string, token: string | null): Promise<TrackedFile[]> {
  const cannotTell = (why: string) => LOOK_FOR.map((name) => ({ name, state: 'unknown' as const, why }));

  if (!res) return cannotTell('the repository tree could not be fetched');
  if (res.status === 403 || res.status === 429) return cannotTell(throttled(res, token).toLowerCase());
  if (!res.ok) return cannotTell(`GitHub answered ${res.status} for the ${ref} tree`);

  let tree: { tree?: { path?: string; type?: string }[]; truncated?: boolean };
  try {
    tree = await res.json();
  } catch {
    return cannotTell('the repository tree came back unreadable');
  }

  return classify(
    (tree.tree ?? [])
      .filter((entry) => entry.type === 'blob' && typeof entry.path === 'string')
      .map((entry) => String(entry.path)),
    Boolean(tree.truncated),
  );
}

/** Which of the tracked files a repository tree contains.
 *
 *  Split out from the fetching and exported because it is the only part of
 *  this file with a decision in it, and it is the part that got it wrong: see
 *  lib/github.test.ts, which pins the monorepo case that caused the rewrite. */
export function classify(paths: string[], truncated: boolean): TrackedFile[] {
  return LOOK_FOR.map((name) => {
    const needle = name.toLowerCase();
    const hits = paths.filter((path) => {
      const lower = path.toLowerCase();
      return lower === needle || lower.endsWith(`/${needle}`);
    });

    // Found is found — but only where the site could actually be serving it
    // from. Matching any path that ends in `/robots.txt` reported next.js's
    // `test/e2e/app-dir-export/app/robots.txt` as the site's robots.txt, which
    // is a fixture in somebody's monorepo and exactly the false positive that
    // gets a whole report ignored.
    const shallow = hits.find((path) => path.split('/').length <= WEB_ROOT_DEPTH + 1);
    if (shallow) return { name, state: 'present' as const, path: shallow };

    const generator = paths.find((path) => GENERATED[name].test(path.toLowerCase()));
    if (generator) return { name, state: 'present' as const, path: generator };

    // A deeper hit is still not nothing. It is not a claim that the site serves
    // this file, and it is not a claim that the file is absent either — which
    // is what the third state is for.
    if (hits.length) {
      return {
        name,
        state: 'unknown' as const,
        why: `only found at ${hits[0]}, too deep in the tree to be what the site serves`,
      };
    }

    // Not found is only *missing* when the tree we searched was the whole tree.
    // Otherwise all we know is that we did not look everywhere.
    if (truncated) {
      return {
        name,
        state: 'unknown' as const,
        why: 'GitHub truncated the repository tree, so this file being absent from it proves nothing',
      };
    }
    return { name, state: 'missing' as const };
  });
}

/** A repository in the import list. */
export type RepoChoice = { fullName: string; private: boolean; pushedAt: string; defaultBranch: string };

/** The login a token belongs to — what the panel shows as "connected as". */
export async function whoami(token: string): Promise<{ id: number; login: string } | null> {
  const res = await get('/user', token).catch(() => null);
  if (!res?.ok) return null;
  const user = await res.json().catch(() => null);
  return typeof user?.login === 'string' && typeof user?.id === 'number' ? { id: user.id, login: user.login } : null;
}

/** The commit a fix starts from, and every file in it. Pinned by SHA so every
 *  read in one fix sees the same tree, and the pull request is based on the
 *  commit the model actually read. */
export type Snapshot = { branch: string; sha: string; paths: string[]; truncated: boolean };

export async function snapshot(
  owner: string,
  name: string,
  branch: string | null,
  token: string,
): Promise<{ ok: true; value: Snapshot } | { ok: false; reason: string }> {
  const json = async (path: string) => {
    const res = await get(path, token).catch(() => null);
    if (!res) throw new Error('Could not reach GitHub.');
    if (res.status === 403 || res.status === 429) throw new Error(throttled(res, token));
    if (!res.ok) throw new Error(`GitHub answered ${res.status} reading ${owner}/${name}.`);
    return res.json();
  };
  try {
    const ref = branch || (await json(`/repos/${owner}/${name}`)).default_branch;
    const head = await json(`/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(ref)}`);
    const sha = String(head.object.sha);
    const tree = await json(`/repos/${owner}/${name}/git/trees/${sha}?recursive=1`);
    const paths = (tree.tree as { path: string; type: string }[]).filter((e) => e.type === 'blob').map((e) => e.path);
    return { ok: true, value: { branch: ref, sha, paths, truncated: Boolean(tree.truncated) } };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

/** One file's text at `sha`, or `null` when there is no such file. */
export async function readFile(
  owner: string,
  name: string,
  sha: string,
  path: string,
  token: string,
): Promise<string | null> {
  const res = await fetch(`${API}/repos/${owner}/${name}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${sha}`, {
    headers: { ...headers(token), accept: 'application/vnd.github.raw+json' },
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub answered ${res.status} reading ${path}.`);
  return res.text();
}
