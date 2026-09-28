import { report } from '@/lib/audits';
import { engine } from '@/lib/engine';
import { limit } from '@/lib/limit';

// A finished report written out as HTML, Markdown or CSV — by the engine's own
// writers, from the copy kept on the server, so nobody can hand the renderer a
// report of their own making.
export async function GET(request: Request, ctx: RouteContext<'/api/audits/[id]/export'>) {
  const slow = await limit('export', request);
  if (slow) return slow;
  const kept = report((await ctx.params).id);
  if (!kept) return new Response('That report is gone — reports are kept for a week.', { status: 404 });
  const as = new URL(request.url).searchParams.get('as') ?? 'html';
  return engine('render', new URLSearchParams({ as }), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ meta: kept.meta, findings: kept.findings, score: kept.score }),
  });
}
