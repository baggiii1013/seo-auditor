// The GitHub App: who signed in, which accounts installed it, and the
// short-lived tokens it mints to act on one of their repositories.
//
// Two kinds of token, and the split is the point of a GitHub App:
//
//   - The **user token** says who is at the keyboard. It is only ever used to
//     ask what that person can see: their installations, and the repositories
//     in each. It expires in eight hours; the refresh token buys another.
//   - The **installation token** is what touches a repository. The server mints
//     it from the app's private key, it lasts an hour, and it can only reach
//     the repositories the owner chose on GitHub's install screen.
//
// `fetch` against the REST API, like lib/github.ts next door, and the JWT is
// signed with `node:crypto` — RS256 over two base64url'd JSON blobs does not
// need a library.

import { createSign } from 'node:crypto';

import { headers, type RepoChoice } from './github.ts';

const API = 'https://api.github.com';

const config = () => ({
  clientId: process.env.GITHUB_APP_CLIENT_ID ?? '',
  clientSecret: process.env.GITHUB_APP_CLIENT_SECRET ?? '',
  slug: process.env.GITHUB_APP_SLUG ?? '',
  // `.env` files carry one line per value, so the PEM arrives with its newlines
  // written as `\n`.
  privateKey: (process.env.GITHUB_APP_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
});

export const appConfigured = () => {
  const c = config();
  return Boolean(c.clientId && c.clientSecret && c.slug && c.privateKey);
};

/** Where GitHub's own screen picks an account and its repositories. The same
 *  page adds an account, and adjusts the repositories of one already added. */
export const installUrl = (state: string) =>
  `https://github.com/apps/${config().slug}/installations/new?state=${encodeURIComponent(state)}`;

/** Where GitHub's consent screen signs someone in as themselves. */
export function authorizeUrl(redirectUri: string, state: string): string {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', config().clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  // No `scope`: a GitHub App's reach is its permissions and the repositories it
  // was installed on, not a scope asked for at sign-in.
  url.searchParams.set('state', state);
  return url.toString();
}

/** The app speaking as itself. Exported for the test, which checks it against
 *  a key it generates rather than the real one. */
export function appJwt(clientId: string, privateKey: string, now = Date.now()): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const seconds = Math.floor(now / 1000);
  // Backdated a minute for clock drift; GitHub refuses anything over ten.
  const body = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iat: seconds - 60, exp: seconds + 540, iss: clientId })}`;
  return `${body}.${createSign('RSA-SHA256').update(body).sign(privateKey, 'base64url')}`;
}

const asApp = () => {
  const c = config();
  return { ...headers(null), authorization: `Bearer ${appJwt(c.clientId, c.privateKey)}` };
};

// ponytail: in memory, per process. A restart mints fresh ones, which costs one
// request each; share them across processes when there is more than one.
const minted = new Map<number, { token: string; expires: number }>();

/** A token for one installation's repositories, or `null` when the app has been
 *  uninstalled or its access withdrawn — which the caller says out loud. */
export async function installationToken(installationId: number): Promise<string | null> {
  const hit = minted.get(installationId);
  // Five minutes' grace: a token handed out now has to outlive the request.
  if (hit && hit.expires - Date.now() > 5 * 60_000) return hit.token;

  const res = await fetch(`${API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: asApp(),
  }).catch(() => null);
  if (!res?.ok) {
    minted.delete(installationId);
    return null;
  }
  const body: { token: string; expires_at: string } = await res.json();
  minted.set(installationId, { token: body.token, expires: Date.parse(body.expires_at) });
  return body.token;
}

/** Which installation reaches `owner/name`, asked as the app — the one answer
 *  a browser cannot be trusted to supply about itself. */
export async function installationFor(owner: string, name: string): Promise<number | null> {
  const res = await fetch(`${API}/repos/${owner}/${name}/installation`, { headers: asApp() }).catch(() => null);
  if (!res?.ok) return null;
  const body: { id?: number } = await res.json();
  return typeof body.id === 'number' ? body.id : null;
}

export type UserToken = { token: string; refreshToken: string | null; expiresAt: string | null };

/** Both halves of the sign-in exchange: a `code` from the callback, or a
 *  refresh token that is about to be all there is. */
async function exchange(grant: Record<string, string>): Promise<UserToken | { error: string }> {
  const c = config();
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: c.clientId, client_secret: c.clientSecret, ...grant }),
  }).catch(() => null);
  const body = await res?.json().catch(() => null);
  if (typeof body?.access_token !== 'string') {
    return { error: body?.error_description ?? 'GitHub did not hand over a token.' };
  }
  return {
    token: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    expiresAt: typeof body.expires_in === 'number' ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null,
  };
}

export const exchangeCode = (code: string) => exchange({ code });

export const refreshUserToken = (refreshToken: string) =>
  exchange({ grant_type: 'refresh_token', refresh_token: refreshToken });

/** Take the app off the user's list of authorized apps on GitHub. Best effort:
 *  signing out here has already happened by the time this is asked. */
export async function revokeUserToken(token: string): Promise<void> {
  const c = config();
  await fetch(`${API}/applications/${c.clientId}/grant`, {
    method: 'DELETE',
    headers: {
      ...headers(null),
      authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`,
    },
    body: JSON.stringify({ access_token: token }),
  }).catch(() => {});
}

/** An account the app is installed on, as the account switcher shows it. */
export type Installation = {
  id: number;
  login: string;
  type: 'User' | 'Organization';
  /** `all` or `selected` — what the owner chose on the install screen. */
  selection: string;
};

type Listed<T> = { ok: true; value: T } | { ok: false; status: number; reason: string };

const failed = (status: number, what: string): Listed<never> => ({
  ok: false,
  status,
  reason:
    status === 401 ? 'GitHub signed you out — continue with GitHub again.' : `GitHub answered ${status} ${what}.`,
});

/** Every installation the signed-in user can reach: their own account and any
 *  organization that installed the app and that they belong to. */
export async function userInstallations(userToken: string): Promise<Listed<Installation[]>> {
  const res = await fetch(`${API}/user/installations?per_page=100`, { headers: headers(userToken) }).catch(() => null);
  if (!res) return { ok: false, status: 502, reason: 'Could not reach GitHub.' };
  if (!res.ok) return failed(res.status, 'listing installations');
  const body: {
    installations: { id: number; account: { login: string; type: string } | null; repository_selection: string }[];
  } = await res.json();
  return {
    ok: true,
    value: body.installations.map((row) => ({
      id: row.id,
      login: row.account?.login ?? String(row.id),
      type: row.account?.type === 'Organization' ? 'Organization' : 'User',
      selection: row.repository_selection,
    })),
  };
}

/** The repositories one installation reaches that this user can also see,
 *  most recently pushed first — the order Vercel's import list uses. */
export async function installationRepos(userToken: string, installationId: number): Promise<Listed<RepoChoice[]>> {
  const repos: RepoChoice[] = [];
  // ponytail: stops at 300 (three pages). Enough for a picker with a search
  // box; follow the Link header to the end if someone has more and misses one.
  for (let page = 1; page <= 3; page++) {
    const res = await fetch(`${API}/user/installations/${installationId}/repositories?per_page=100&page=${page}`, {
      headers: headers(userToken),
      cache: 'no-store',
    }).catch(() => null);
    if (!res) return { ok: false, status: 502, reason: 'Could not reach GitHub.' };
    if (!res.ok) return failed(res.status, 'listing repositories');
    const body: {
      repositories: { full_name: string; private: boolean; pushed_at: string; default_branch: string }[];
    } = await res.json();
    for (const r of body.repositories) {
      repos.push({ fullName: r.full_name, private: r.private, pushedAt: r.pushed_at, defaultBranch: r.default_branch });
    }
    if (body.repositories.length < 100) break;
  }
  repos.sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''));
  return { ok: true, value: repos };
}
