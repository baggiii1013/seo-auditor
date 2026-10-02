import { fixFor, stopFix } from '@/lib/fixes';
import { currentUser } from '@/lib/git-state';

/** One fix as it stands — polled while the model works. */
export async function GET(_request: Request, ctx: RouteContext<'/api/fixes/[id]'>) {
  const user = await currentUser();
  const job = user && (await fixFor(user, (await ctx.params).id));
  if (!job) return Response.json({ error: 'No such fix.' }, { status: 404 });
  return Response.json({ job });
}

/** Stop it. The panel keeps polling and sees it end. */
export async function DELETE(_request: Request, ctx: RouteContext<'/api/fixes/[id]'>) {
  const user = await currentUser();
  const job = user && (await stopFix(user, (await ctx.params).id));
  if (!job) return Response.json({ error: 'No such fix.' }, { status: 404 });
  return new Response(null, { status: 204 });
}
