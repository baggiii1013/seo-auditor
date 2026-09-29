import { openFixPr } from '@/lib/fixes';
import { currentUser } from '@/lib/git-state';

/** Open the pull request for a finished fix, once the user has read the diff. */
export async function POST(_request: Request, ctx: RouteContext<'/api/fixes/[id]/pull'>) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Continue with GitHub first.' }, { status: 401 });
  const opened = await openFixPr(user, (await ctx.params).id);
  if ('error' in opened) return Response.json({ error: opened.error }, { status: opened.status });
  return Response.json(opened);
}
