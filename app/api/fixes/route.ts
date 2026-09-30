import { linkedRepo } from '@/lib/db';
import { repoFixes, startFix } from '@/lib/fixes';
import { currentUser } from '@/lib/git-state';
import { limit } from '@/lib/limit';
import { store } from '@/lib/store';

// Fixing findings in the repository linked to a site — see lib/fixes.ts. Only
// for whoever linked it: the session decides the user, the user decides the
// repository, and the browser only names the site.

const bad = (error: string, status = 400) => Response.json({ error }, { status });

/** The linked repository's recent fixes, and their pull requests. */
export async function GET(request: Request) {
  const origin = new URL(request.url).searchParams.get('origin');
  if (!origin) return bad('An `origin` is required.');
  const user = await currentUser();
  const repo = user && linkedRepo(store(), user, origin);
  if (!repo) return Response.json({ jobs: [] });
  return Response.json({ jobs: await repoFixes(repo) });
}

export async function POST(request: Request) {
  const body: { origin?: string; audit?: string; checks?: string[]; request?: string } | null = await request.json().catch(() => null);
  if (!body?.origin || !body.audit || !Array.isArray(body.checks)) return bad('Expected { origin, audit, checks, request? }.');
  const user = await currentUser();
  if (!user) return bad('Continue with GitHub first.', 401);
  const repo = linkedRepo(store(), user, body.origin);
  if (!repo) return bad('Link a repository to this site first.', 404);
  const slow = await limit('fix', request);
  if (slow) return slow;
  const started = await startFix(user, repo, body.audit, body.checks.map(String), String(body.request ?? ''));
  if ('error' in started) return bad(started.error, started.status);
  return Response.json(started, { status: 202 });
}
