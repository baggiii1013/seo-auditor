import { targetFor } from '@/engine/worker/index.mjs';
import { enqueue } from '@/lib/audits';
import { refuse } from '@/lib/engine';
import { clientIp, limit } from '@/lib/limit';

// Ask for a crawl. The answer is an id to follow at /api/audits/<id>/events,
// not the crawl itself — see lib/audits.ts. The form's controls arrive as the
// query string, the same one the engine's own form sends.
export async function POST(request: Request) {
  const params = new URL(request.url).searchParams;
  const target = targetFor(params.get('url'), {});
  if (target.error !== undefined) return new Response(target.error, { status: 400 });
  // Said up front: the engine would refuse every fetch anyway, but then report
  // the site as unreachable, which reads like a site problem.
  const refused = await refuse(target.url);
  if (refused) return new Response(`That site cannot be audited from here: ${refused}.`, { status: 400 });

  const slow = await limit('audit', request);
  if (slow) return slow;
  const ip = clientIp(request);
  const queued = await enqueue(params, ip);
  if ('error' in queued) return new Response(queued.error, { status: 429 });
  return Response.json(queued, { status: 202 });
}
