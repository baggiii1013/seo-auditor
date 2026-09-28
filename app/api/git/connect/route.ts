import { LOCAL_USER, forgetGithubAccount, githubAccount } from '@/lib/db';
import { appConfigured, authorizeUrl, installUrl, revokeUserToken } from '@/lib/github-app';
import { store } from '@/lib/git-state';

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

/** Sign out. Links stay, and keep reading through their installation. */
export async function DELETE() {
  const saved = githubAccount(store(), LOCAL_USER);
  forgetGithubAccount(store(), LOCAL_USER);
  if (saved) await revokeUserToken(saved.token);
  return Response.json({ ok: true });
}
