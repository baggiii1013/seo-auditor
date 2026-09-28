import { engine, refuse } from '@/lib/engine';
import { limit } from '@/lib/limit';

// What a run would do, without doing it: a handful of requests, not hundreds.
export async function GET(request: Request) {
  const slow = await limit('preview', request);
  if (slow) return slow;
  const params = new URL(request.url).searchParams;
  const refused = await refuse(params.get('url') ?? '');
  if (refused) return new Response(`That site cannot be audited from here: ${refused}.`, { status: 400 });
  return engine('preview', params);
}
