import { gitAuth } from '@/lib/git-state';
import { listRepos } from '@/lib/github';

// The import list: every repository the connected account can see.

export async function GET() {
  const { token } = gitAuth();
  if (!token) return Response.json({ error: 'Connect GitHub first.' }, { status: 401 });
  const list = await listRepos(token);
  return list.ok ? Response.json({ repos: list.repos }) : Response.json({ error: list.reason }, { status: 502 });
}
