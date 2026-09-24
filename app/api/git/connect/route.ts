import { LOCAL_USER, forgetGithubAccount } from '@/lib/db';
import { store } from '@/lib/git-state';

// Start the "Connect GitHub" popup: send it to GitHub's consent screen.
//
// Needs an OAuth app (github.com/settings/developers) whose callback URL is
// `<this app>/api/git/callback`, and its GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
// in the environment.

export async function GET(request: Request) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return new Response('GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are not set in .env.local.', { status: 500 });
  }

  const state = crypto.randomUUID();
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('redirect_uri', `${new URL(request.url).origin}/api/git/callback`);
  // `repo` is the only scope that can read a private repository; GitHub has no
  // read-only one for OAuth apps. Nothing here writes with it — see lib/github.ts.
  authorize.searchParams.set('scope', 'repo read:user');
  authorize.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: {
      location: authorize.toString(),
      // CSRF: the callback only accepts the state it was sent off with.
      'set-cookie': `gh_oauth_state=${state}; Path=/api/git; HttpOnly; SameSite=Lax; Max-Age=600`,
    },
  });
}

/** Disconnect. Links stay; they fall back to GITHUB_TOKEN or anonymous reads. */
export async function DELETE() {
  forgetGithubAccount(store(), LOCAL_USER);
  return Response.json({ ok: true });
}
