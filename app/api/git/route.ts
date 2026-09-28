import { linkRepo, linkedRepo, unlinkRepo } from '@/lib/db';
import { installationFor } from '@/lib/github-app';
import { currentUser, tokenFor, userToken } from '@/lib/git-state';
import { store } from '@/lib/store';
import { look, parseRepo, type Look } from '@/lib/github';
import type { Repo } from '@/lib/db';

// Which repository is linked to an audited site, and what is in it.
//
// Read-only against GitHub. The one thing this route writes is the link itself,
// and that lives in the app's own SQLite store — see lib/db.ts.
//
// Only called once a repository is linked (or being linked): whether one is, and
// who is connected, reaches the report with the page — see lib/git-state.ts.
// Links belong to whoever this browser's session says it is; a visitor who
// never continued with GitHub has none.

type Payload = { repo: Repo | null; look?: Look };

const bad = (message: string, status = 400) => Response.json({ error: message }, { status });

export async function GET(request: Request) {
  const origin = new URL(request.url).searchParams.get('origin');
  if (!origin) return bad('An `origin` is required.');
  const user = await currentUser();
  const repo = user && linkedRepo(store(), user, origin);
  if (!repo) return Response.json({ repo: null } satisfies Payload);
  const { token, lost } = await tokenFor(repo);
  const seen: Look = lost
    ? {
        ok: false,
        reason: `The GitHub App can no longer reach ${repo.owner}/${repo.name} — it was uninstalled, or the repository was taken off its list. Adjust its permissions on GitHub, or unlink and import it again.`,
      }
    : await look(repo.owner, repo.name, repo.branch, token);
  return Response.json({ repo, look: seen } satisfies Payload);
}

export async function POST(request: Request) {
  let body: { origin?: string; repo?: string };
  try {
    body = await request.json();
  } catch {
    return bad('Expected a JSON body.');
  }

  const origin = body.origin ?? new URL(request.url).searchParams.get('origin');
  if (!origin) return bad('An `origin` is required.');

  const parsed = parseRepo(body.repo ?? '');
  if (!parsed) return bad('That is not a repository.');

  const userId = await currentUser();
  const user = userId && (await userToken(userId));
  if (!userId || !user) return bad('Continue with GitHub first.', 401);

  // Look before writing, and look *as the user*: a user token only reaches
  // repositories that person can see and the app is installed on, so a
  // successful look is the permission check. The installation is then asked of
  // GitHub, never taken from the browser. `null` branch: the default one,
  // resolved at read time.
  const seen = await look(parsed.owner, parsed.name, null, user);
  if (!seen.ok) return bad(seen.reason, 422);

  const installationId = await installationFor(parsed.owner, parsed.name);
  if (!installationId) {
    return bad(`The GitHub App is not installed on ${parsed.owner}/${parsed.name}. Adjust its permissions to add it.`, 422);
  }

  const repo = linkRepo(store(), userId, origin, { ...parsed, branch: null, installationId });
  return Response.json({ repo, look: seen } satisfies Payload);
}

export async function DELETE(request: Request) {
  const origin = new URL(request.url).searchParams.get('origin');
  if (!origin) return bad('An `origin` is required.');
  const user = await currentUser();
  if (!user) return bad('Continue with GitHub first.', 401);
  unlinkRepo(store(), user, origin);
  return Response.json({ repo: null } satisfies Payload);
}
