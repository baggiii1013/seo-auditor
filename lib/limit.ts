import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';

// How often one address may ask for the expensive things — rate-limiter-flexible,
// counted in this process's memory.
//
// ponytail: one process only, and it trusts X-Forwarded-For — correct behind a
// proxy that overwrites it (every PaaS, nginx with real_ip), spoofable with
// none. More than one process: swap RateLimiterMemory for RateLimiterRedis,
// same options, same calls.

const HOUR = 3600;

const limiters = {
  audit: new RateLimiterMemory({ keyPrefix: 'audit', points: 10, duration: HOUR }),
  preview: new RateLimiterMemory({ keyPrefix: 'preview', points: 30, duration: HOUR }),
  export: new RateLimiterMemory({ keyPrefix: 'export', points: 60, duration: HOUR }),
};

/** The caller's address, as the proxy in front reported it. */
export const clientIp = (request: Request) =>
  request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'local';

/** A 429 to send back when this address has had its share of `what`, or
 *  `null` to go ahead — which also counts this one. */
export async function limit(what: keyof typeof limiters, request: Request): Promise<Response | null> {
  try {
    await limiters[what].consume(clientIp(request));
    return null;
  } catch (refused) {
    if (!(refused instanceof RateLimiterRes)) throw refused;
    const seconds = Math.ceil(refused.msBeforeNext / 1000);
    return new Response(`Too many ${what}s from this address. Try again in ${Math.ceil(seconds / 60)} min.`, {
      status: 429,
      headers: { 'retry-after': String(seconds) },
    });
  }
}
