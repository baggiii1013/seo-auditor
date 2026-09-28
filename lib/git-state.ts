import { libraryRoot } from '@/engine/src/library.mjs';

import { LOCAL_USER, forgetGithubAccount, githubAccount, linkedRepos, openDb, saveGithubAccount, type Repo } from './db';
import { envToken } from './github';
import { appConfigured, installationToken, refreshUserToken } from './github-app';

// Who GitHub is read as, and what is linked — server-side only. The page reads
// this at render so the report can draw the panel without calling /api/git.

/** Who signed in through the GitHub App, or nobody. Never a token: this
 *  crosses to the browser. */
export type GitAccount = { login: string } | null;

export type GitState = { account: GitAccount; canConnect: boolean; links: Record<string, Repo> };

export const store = () => openDb(libraryRoot());

// Two requests refreshing at once would both spend the same refresh token, and
// GitHub rotates it on first use — so the second would fail and sign the user
// out. One refresh at a time, shared by everyone waiting on it.
let refreshing: Promise<string | null> | null = null;

/** The signed-in user's token, refreshed when it is about to expire. `null`
 *  when nobody is signed in, or the refresh was refused — which signs them out,
 *  because a token that cannot be renewed is one that is about to stop. */
export async function userToken(): Promise<string | null> {
  const saved = githubAccount(store(), LOCAL_USER);
  if (!saved) return null;
  if (!saved.expiresAt || Date.parse(saved.expiresAt) - Date.now() > 60_000) return saved.token;
  if (!saved.refreshToken) return null;

  refreshing ??= refreshUserToken(saved.refreshToken)
    .then((fresh) => {
      if ('error' in fresh) {
        forgetGithubAccount(store(), LOCAL_USER);
        return null;
      }
      saveGithubAccount(store(), LOCAL_USER, { login: saved.login, ...fresh });
      return fresh.token;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
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
export function gitState(): GitState {
  try {
    const saved = githubAccount(store(), LOCAL_USER);
    return {
      account: saved ? { login: saved.login } : null,
      canConnect: appConfigured(),
      links: linkedRepos(store(), LOCAL_USER),
    };
  } catch (err) {
    console.error('git state unavailable:', err);
    return { account: null, canConnect: false, links: {} };
  }
}
