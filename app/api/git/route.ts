import { libraryRoot } from '@/engine/src/library.mjs';
import { LOCAL_USER, linkRepo, linkedRepo, openDb, unlinkRepo } from '@/lib/db';
import { look, parseRepo, type Look } from '@/lib/github';
import type { Repo } from '@/lib/db';

// Which repository is linked to an audited site, and what is in it.
//
// Read-only against GitHub. The one thing this route writes is the link itself,
// and that lives in the app's own SQLite store — see lib/db.ts.
//
// `LOCAL_USER` is threaded through every call rather than assumed inside the
// queries. There is one user today; the day there is a session, this is the
// only line in the file that changes.

type Payload = { repo: Repo | null; look?: Look };

const store = () => openDb(libraryRoot());

const bad = (message: string, status = 400) => Response.json({ error: message }, { status });

/** The link and the repository's current state, in one answer — the panel has
 *  nothing to draw with one and not the other, so a second round trip would
 *  only be a second chance to fail. */
async function payload(origin: string): Promise<Payload> {
  const repo = linkedRepo(store(), LOCAL_USER, origin);
  if (!repo) return { repo: null };
  return { repo, look: await look(repo.owner, repo.name, repo.branch) };
}

export async function GET(request: Request) {
  const origin = new URL(request.url).searchParams.get('origin');
  if (!origin) return bad('An `origin` is required.');
  return Response.json(await payload(origin));
}

export async function POST(request: Request) {
  let body: { origin?: string; repo?: string; branch?: string };
  try {
    body = await request.json();
  } catch {
    return bad('Expected a JSON body.');
  }

  const origin = body.origin ?? new URL(request.url).searchParams.get('origin');
  if (!origin) return bad('An `origin` is required.');

  const parsed = parseRepo(body.repo ?? '');
  if (!parsed) {
    return bad('That is not a repository. Give it `owner/name`, or the URL from the address bar.');
  }

  // An empty branch box means the default branch, which is a fact about the
  // repository and is resolved when it is read. Storing the string "" here
  // would mean asking GitHub for a branch called nothing.
  const branch = (body.branch ?? '').trim() || null;

  // Look before writing. A link to a repository that cannot be read is a line
  // in the report header claiming a connection there isn't one — and the reason
  // that comes back is already the instruction for fixing it, whether that is a
  // typo or a private repository with no GITHUB_TOKEN set.
  const seen = await look(parsed.owner, parsed.name, branch);
  if (!seen.ok) return bad(seen.reason, 422);

  const repo = linkRepo(store(), LOCAL_USER, origin, { ...parsed, branch });
  return Response.json({ repo, look: seen } satisfies Payload);
}

export async function DELETE(request: Request) {
  const origin = new URL(request.url).searchParams.get('origin');
  if (!origin) return bad('An `origin` is required.');
  unlinkRepo(store(), LOCAL_USER, origin);
  return Response.json({ repo: null } satisfies Payload);
}
