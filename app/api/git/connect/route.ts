import { cookies } from 'next/headers';

import { SESSION_COOKIE, endSession, forgetGithubAccount, githubAccount, sessionCookie } from '@/lib/db';
import { appConfigured, authorizeUrl, installUrl, revokeUserToken } from '@/lib/github-app';
import { currentUser } from '@/lib/git-state';
import { store } from '@/lib/store';

// Start a GitHub popup: sign in (`/api/git/connect`), or GitHub's own install
// screen (`?install`), which picks an account and the repositories the app may
// reach — and is the same screen for adding one later.
//
// Needs a GitHub App whose callback URL is `<this app>/api/git/callback`, with
// "Request user authorization during installation" on, and its GITHUB_APP_*
// values in the environment — see PLAN.md.

export async function GET(request: Request) {
  if (!appConfigured()) {
    return new Response('The GITHUB_APP_* values are not set in .env.local.', { status: 500 });
  }

  const url = new URL(request.url);
  const state = crypto.randomUUID();
  const to = url.searchParams.has('install')
    ? installUrl(state)
    : authorizeUrl(`${url.origin}/api/git/callback`, state);

  return new Response(null, {
    status: 302,
    headers: {
      location: to,
      // CSRF: the callback only accepts the state it was sent off with.
      'set-cookie': `gh_oauth_state=${state}; Path=/api/git; HttpOnly; SameSite=Lax; Max-Age=600`,
    },
  });
}

/** Sign out: this browser's session ends and the GitHub grant is revoked.
 *  Links stay, for the next time this person continues with GitHub. */
export async function DELETE(request: Request) {
  const user = await currentUser();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) endSession(store(), token);
  const saved = user ? githubAccount(store(), user) : null;
  if (user) forgetGithubAccount(store(), user);
  if (saved) await revokeUserToken(saved.token);
  return Response.json({ ok: true }, { headers: { 'set-cookie': sessionCookie(request, '', 0) } });
}
