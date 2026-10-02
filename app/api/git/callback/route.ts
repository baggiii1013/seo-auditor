import { createSession, saveGithubAccount, sessionCookie, userForGithub } from '@/lib/db';
import { whoami } from '@/lib/github';
import { exchangeCode } from '@/lib/github-app';
import { store } from '@/lib/store';

// Where GitHub sends the popup back to. Swap the code for a token, keep it, and
// tell the report that opened the popup — which is still on screen, holding an
// audit that only lives in its memory, which is why this is a popup and not a
// redirect of the page itself.

/** A page that tells the opener how it went and closes itself — and, on
 *  success, hands this browser its session cookie. */
function done(message: string, ok: boolean, cookie?: string) {
  // The popup is all the user sees of a refusal; this is the server's copy.
  if (!ok) console.error(`github sign-in refused: ${message}`);
  // On success `message` is the login, which the panel shows as "connected as".
  const payload = JSON.stringify({ type: 'github-connect', ok, message }).replace(/</g, '\\u003c');
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>GitHub</title>
<p style="font:14px system-ui;padding:2rem">${ok ? 'Connected. You can close this window.' : message.replace(/[<&]/g, '')}</p>
<script>window.opener?.postMessage(${payload}, location.origin); ${ok ? 'window.close();' : ''}</script>`,
    {
      status: ok ? 200 : 400,
      headers: [
        ['content-type', 'text/html; charset=utf-8'],
        ['set-cookie', 'gh_oauth_state=; Path=/api/git; Max-Age=0'],
        ...(cookie ? [['set-cookie', cookie] as [string, string]] : []),
      ],
    },
  );
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get('code');
  const state = params.get('state');
  const expected = /(?:^|;\s*)gh_oauth_state=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1];

  if (params.get('error')) return done(params.get('error_description') ?? 'GitHub declined the connection.', false);
  // Installing on an organization you do not own asks its owners instead.
  if (params.get('setup_action') === 'request') {
    return done('Sent to the organization’s owners to approve. Once they do, it shows up in the list.', false);
  }

  if (!code || !state || state !== expected) {
    // Back from the install screen with nothing we can check the code against.
    // Sign in the ordinary way instead: the app is authorized by now, so
    // GitHub answers that without asking again.
    if (params.has('installation_id')) return Response.redirect(new URL('/api/git/connect', request.url), 302);
    return done('The sign-in expired or did not start here. Try again.', false);
  }

  const got = await exchangeCode(code);
  if ('error' in got) return done(got.error, false);

  const who = await whoami(got.token);
  if (!who) return done('Got a token, but GitHub would not say whose it is.', false);

  const db = await store();
  const user = await userForGithub(db, who.id, who.login);
  await saveGithubAccount(db, user, { login: who.login, ...got });
  return done(who.login, true, sessionCookie(request, await createSession(db, user)));
}
