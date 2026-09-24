import { libraryRoot } from '@/engine/src/library.mjs';

import { LOCAL_USER, githubAccount, linkedRepos, openDb, type Repo } from './db';
import { envToken } from './github';

// Who GitHub is read as, and what is linked — server-side only. The page reads
// this at render so the report can draw the panel without calling /api/git.

/** The account connected through the popup, a pasted GITHUB_TOKEN, or nobody.
 *  Never the token itself: this crosses to the browser. */
export type GitAccount = { login: string | null; via: 'oauth' | 'env' } | null;

export type GitState = { account: GitAccount; canConnect: boolean; links: Record<string, Repo> };

export const store = () => openDb(libraryRoot());

export function gitAuth(): { token: string | null; account: GitAccount; canConnect: boolean } {
  const canConnect = Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
  const saved = githubAccount(store(), LOCAL_USER);
  if (saved) return { token: saved.token, account: { login: saved.login, via: 'oauth' }, canConnect };
  const env = envToken();
  return { token: env, account: env ? { login: null, via: 'env' } : null, canConnect };
}

/** Never throws: this runs on every render of the home page, and a broken
 *  store must cost the git panel, not the auditor. */
export function gitState(): GitState {
  try {
    const { account, canConnect } = gitAuth();
    return { account, canConnect, links: linkedRepos(store(), LOCAL_USER) };
  } catch (err) {
    console.error('git state unavailable:', err);
    return { account: null, canConnect: false, links: {} };
  }
}
