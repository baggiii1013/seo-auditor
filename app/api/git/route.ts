import { LOCAL_USER, linkRepo, linkedRepo, unlinkRepo } from '@/lib/db';
import { gitAuth, store } from '@/lib/git-state';
import { look, parseRepo, type Look } from '@/lib/github';
import type { Repo } from '@/lib/db';

// Which repository is linked to an audited site, and what is in it.
//
// Read-only against GitHub. The one thing this route writes is the link itself,
// and that lives in the app's own SQLite store — see lib/db.ts.
//
// Only called once a repository is linked (or being linked): whether one is, and
// who is connected, reaches the report with the page — see lib/git-state.ts.

type Payload = { repo: Repo | null; look?: Look };

const bad = (message: string, status = 400) => Response.json({ error: message }, { status });

export async function GET(request: Request) {
  const origin = new URL(request.url).searchParams.get('origin');
  if (!origin) return bad('An `origin` is required.');
  const repo = linkedRepo(store(), LOCAL_USER, origin);
  if (!repo) return Response.json({ repo: null } satisfies Payload);
  const seen = await look(repo.owner, repo.name, repo.branch, gitAuth().token);
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

  // Look before writing. A link to a repository that cannot be read is a line
  // in the report header claiming a connection there isn't one — and the reason
  // that comes back is already the instruction for fixing it. `null` branch:
  // the default one, resolved at read time.
  const seen = await look(parsed.owner, parsed.name, null, gitAuth().token);
  if (!seen.ok) return bad(seen.reason, 422);

  const repo = linkRepo(store(), LOCAL_USER, origin, { ...parsed, branch: null });
  return Response.json({ repo, look: seen } satisfies Payload);
}

export async function DELETE(request: Request) {
  const origin = new URL(request.url).searchParams.get('origin');
  if (!origin) return bad('An `origin` is required.');
  unlinkRepo(store(), LOCAL_USER, origin);
  return Response.json({ repo: null } satisfies Payload);
}
