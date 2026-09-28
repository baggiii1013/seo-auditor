// Which addresses a crawl may not reach. Handed to the engine's fetcher by
// lib/engine.ts, so every page, sitemap, redirect hop and checked link asks.
//
// Anything a visitor types or a sitemap lists is fetched *from this server*,
// so without this a report could carry back the cloud metadata endpoint, an
// admin panel on localhost, or anything else on the private network.

import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local — where cloud metadata lives
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 3], // multicast and reserved, through 255.255.255.255
] as const) {
  blocked.addSubnet(net, bits, 'ipv4');
}
for (const [net, bits] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(net, bits, 'ipv6');
}

/** Whether one literal address is off-limits. IPv4 written as IPv6
 *  (`::ffff:127.0.0.1`) is judged as the IPv4 it is. */
export function internalAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return internalAddress(mapped);
  const family = isIP(address);
  if (!family) return true; // not an address at all: refuse rather than guess
  return blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** A reason to refuse `url`, or `null` to let it through.
 *
 *  ponytail: checks the name, then `fetch` resolves it again — a DNS server
 *  that answers public then private (rebinding) slips through the gap. Pin the
 *  checked address with a custom undici dispatcher if that ever matters. */
export async function refuseInternal(url: string): Promise<string | null> {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return 'not a URL';
  }
  if (isIP(host)) return internalAddress(host) ? `${host} is a private address` : null;
  // `localhost` and friends resolve locally and never reach DNS at all.
  if (host === 'localhost' || host.endsWith('.localhost')) return `${host} is this server`;

  const addresses = await lookup(host, { all: true, verbatim: true }).catch(() => null);
  // Unresolvable: let fetch fail and report it the way the engine already does.
  if (!addresses) return null;
  const inside = addresses.find((a) => internalAddress(a.address));
  return inside ? `${host} resolves to a private address (${inside.address})` : null;
}
