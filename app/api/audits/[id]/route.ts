import { cancel } from '@/lib/audits';

/** Stop waiting for a crawl. See `cancel()` for what that can and cannot stop. */
export async function DELETE(_: Request, ctx: RouteContext<'/api/audits/[id]'>) {
  await cancel((await ctx.params).id);
  return new Response(null, { status: 204 });
}
