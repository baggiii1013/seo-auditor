import { fixWorkbook } from '@/lib/fixes';
import { currentUser } from '@/lib/git-state';

/** A finished fix as an Excel workbook: the problems, what was done, the diffs. */
export async function GET(_request: Request, ctx: RouteContext<'/api/fixes/[id]/report'>) {
  const user = await currentUser();
  const made = user && (await fixWorkbook(user, (await ctx.params).id));
  if (!made) return Response.json({ error: 'No such fix.' }, { status: 404 });
  if ('error' in made) return Response.json({ error: made.error }, { status: made.status });
  return new Response(new Uint8Array(made.file), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${made.name.replace(/[^\w.-]/g, '_')}"`,
    },
  });
}
