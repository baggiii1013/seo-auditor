import { cookies } from 'next/headers';

import { SESSION_COOKIE, forgetGithubAccount, githubAccount, linkedRepos, saveGithubAccount, sessionUser, type Repo } from './db';
import { envToken } from './github';
import { aiConfigured } from './fixer';
import { appConfigured, installationToken, refreshUserToken } from './github-app';
import { store } from './store';

// Who GitHub is read as, and what is linked — server-side only. The page reads
// this at render so the report can draw the panel without calling /api/git.
//
// Auditing needs nobody. Only linking a repository does: continuing with GitHub
// puts a random session id in this browser's cookie, and everything it unlocks
// — the GitHub tokens, the links — stays in the store, looked up by that id.

/** Who signed in through the GitHub App, or nobody. Never a token: this
 *  crosses to the browser. */
export type GitAccount = { login: string } | null;

/** `canFix`: a model is set up, so a linked repository can be fixed. */
export type GitState = { account: GitAccount; canConnect: boolean; canFix: boolean; links: Record<string, Repo> };

/** The signed-in user behind this request's cookie, or `null` for a visitor
 *  who never continued with GitHub. */
export async function currentUser(): Promise<number | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? sessionUser(await store(), token) : null;
}

// Two requests refreshing at once would both spend the same refresh token, and
// GitHub rotates it on first use — so the second would fail and sign the user
// out. One refresh per user at a time, shared by everyone waiting on it.
const refreshing = new Map<number, Promise<string | null>>();

/** `userId`'s GitHub token, refreshed when it is about to expire. `null` when
 *  they never connected, or the refresh was refused — which signs them out,
 *  because a token that cannot be renewed is one that is about to stop. */
export async function userToken(userId: number): Promise<string | null> {
  const saved = await githubAccount(await store(), userId);
  if (!saved) return null;
  if (!saved.expiresAt || Date.parse(saved.expiresAt) - Date.now() > 60_000) return saved.token;
  if (!saved.refreshToken) return null;

  let pending = refreshing.get(userId);
  if (!pending) {
    pending = refreshUserToken(saved.refreshToken)
      .then(async (fresh) => {
        if ('error' in fresh) {
          await forgetGithubAccount(await store(), userId);
          return null;
        }
        await saveGithubAccount(await store(), userId, { login: saved.login, ...fresh });
        return fresh.token;
      })
      .finally(() => refreshing.delete(userId));
    refreshing.set(userId, pending);
  }
  return pending;
}

/** What to read `repo` as. The installation it was linked through when there
 *  is one — `lost` when that installation no longer answers, so the panel can
 *  say so instead of reading a private repository anonymously and reporting it
 *  gone. Otherwise the pasted `GITHUB_TOKEN`, or nobody. */
export async function tokenFor(repo: Repo | null): Promise<{ token: string | null; lost: boolean }> {
  if (repo?.installationId) {
    const token = await installationToken(repo.installationId);
    return { token, lost: !token };
  }
  return { token: envToken(), lost: false };
}

/** Never throws: this runs on every render of the home page, and a broken
 *  store must cost the git panel, not the auditor. */
export async function gitState(): Promise<GitState> {
  const canConnect = appConfigured();
  const canFix = aiConfigured();
  try {
    const user = await currentUser();
    const db = await store();
    const saved = user ? await githubAccount(db, user) : null;
    return {
      account: saved ? { login: saved.login } : null,
      canConnect,
      canFix,
      links: user ? await linkedRepos(db, user) : {},
    };
  } catch (err) {
    console.error('git state unavailable:', err);
    return { account: null, canConnect: false, canFix: false, links: {} };
  }
}
