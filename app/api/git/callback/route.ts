import { LOCAL_USER, saveGithubAccount } from '@/lib/db';
import { store } from '@/lib/git-state';
import { whoami } from '@/lib/github';

// Where GitHub sends the popup back to. Swap the code for a token, keep it, and
// tell the report that opened the popup — which is still on screen, holding an
// audit that only lives in its memory, which is why this is a popup and not a
// redirect of the page itself.

/** A page that tells the opener how it went and closes itself. */
function done(message: string, ok: boolean) {
  // On success `message` is the login, which the panel shows as "connected as".
  const payload = JSON.stringify({ type: 'github-connect', ok, message }).replace(/</g, '\\u003c');
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>GitHub</title>
<p style="font:14px system-ui;padding:2rem">${ok ? 'Connected. You can close this window.' : message.replace(/[<&]/g, '')}</p>
<script>window.opener?.postMessage(${payload}, location.origin); ${ok ? 'window.close();' : ''}</script>`,
    {
      status: ok ? 200 : 400,
      headers: { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'gh_oauth_state=; Path=/api/git; Max-Age=0' },
    },
  );
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get('code');
  const state = params.get('state');
  const expected = /(?:^|;\s*)gh_oauth_state=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1];

  if (params.get('error')) return done(params.get('error_description') ?? 'GitHub declined the connection.', false);
  if (!code || !state || state !== expected) return done('The sign-in expired or did not start here. Try again.', false);

  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  }).catch(() => null);
  const body = await res?.json().catch(() => null);
  const token: unknown = body?.access_token;
  if (typeof token !== 'string') return done(body?.error_description ?? 'GitHub did not hand over a token.', false);

  const login = await whoami(token);
  if (!login) return done('Got a token, but GitHub would not say whose it is.', false);

  saveGithubAccount(store(), LOCAL_USER, { login, token });
  return done(login, true);
}
