import { known, watch, type AuditEvent } from '@/lib/audits';

// One crawl's log, then its report, as server-sent events. Leaving costs the
// crawl nothing: it runs on the server either way, and coming back — a reload,
// a dropped connection that EventSource retries on its own — picks up after
// the last line this browser saw, then gets the report when there is one.

export async function GET(request: Request, ctx: RouteContext<'/api/audits/[id]/events'>) {
  const { id } = await ctx.params;
  if (!known(id)) return new Response('No such audit — it finished over a week ago, or never started.', { status: 404 });

  const after = Number.parseInt(request.headers.get('last-event-id') ?? '', 10);
  const encoder = new TextEncoder();
  let stop = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        stop();
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* the browser already left */
        }
      };
      const send = (line: AuditEvent) => {
        try {
          controller.enqueue(encoder.encode(`id: ${line.seq}\nevent: ${line.event}\ndata: ${line.data}\n\n`));
        } catch {
          return close();
        }
        if (line.event !== 'progress') close();
      };
      // A queue can be quiet for minutes, and proxies drop connections that are.
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          close();
        }
      }, 25_000);
      stop = watch(id, Number.isFinite(after) ? after : 0, send);
      request.signal.addEventListener('abort', close);
    },
    cancel: () => stop(),
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
}
