import type { IncomingHttpHeaders } from 'node:http';
import { isIP } from 'node:net';

// The address that rate limits count against. Behind a reverse proxy every connection comes from
// the proxy, so with TRUST_PROXY set the address is the last entry of X-Forwarded-For, the one
// that the proxy itself added. IPv6 addresses are grouped by their /64 network, since one
// household or phone usually gets a whole /64.

// What the limits count against when no address can be made out. One bucket for all of those is
// strict, but a connection must never get past the limits by hiding where it comes from.
export const UNKNOWN_ADDRESS = 'unknown';

export function clientIp(address: string | undefined, headers: IncomingHttpHeaders, trustProxy: boolean): string {
  let forwarded: string | null = null;
  if (trustProxy) {
    const header = headers['x-forwarded-for'];
    const last = (Array.isArray(header) ? header.join(',') : (header ?? ''))
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .at(-1);
    forwarded = last === undefined ? null : groupIp(last);
  }
  // An entry that is no address, such as "unknown", leaves the proxy's own address to count.
  return forwarded ?? groupIp(address ?? '') ?? UNKNOWN_ADDRESS;
}

// What a connection's country is when it can't be made out, written as Cloudflare writes it.
export const UNKNOWN_COUNTRY = 'XX';

// The country of a connection, for the status page: the two letters of the CF-IPCountry header
// that Cloudflare adds to every request it passes on. Like X-Forwarded-For, the header is only
// believed with TRUST_PROXY set, since anyone else can send it too. Cloudflare writes "T1" for
// Tor, which counts as unknown, like anything that isn't two letters.
export function clientCountry(headers: IncomingHttpHeaders, trustProxy: boolean): string {
  const header = trustProxy ? headers['cf-ipcountry'] : undefined;
  return typeof header === 'string' && /^[a-z]{2}$/i.test(header) ? header.toUpperCase() : UNKNOWN_COUNTRY;
}

// The key that an address counts under, or null when the text is no address. Proxies write
// addresses in more than one way: with a port ("203.0.113.9:4711", "[2001:db8::1]:4711"), with a
// zone ("fe80::1%eth0"), and IPv4 inside IPv6 in dotted or in hexadecimal form.
export function groupIp(text: string): string | null {
  const ip = bare(text);
  const version = isIP(ip);
  if (version === 4) return ip;
  if (version !== 6) return null;
  const groups = ipv6Groups(ip);
  // ::ffff:a.b.c.d is an IPv4 address, however it is spelled.
  const [, , , , , mapped, high = 0, low = 0] = groups;
  if (mapped === 0xffff && groups.slice(0, 5).every((group) => group === 0)) {
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':')}::/64`;
}

// An address without the port, brackets or zone around it.
function bare(text: string): string {
  const trimmed = text.trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(trimmed);
  if (bracketed) return withoutZone(bracketed[1] as string);
  // One colon can only be the one before a port: an IPv6 address has at least two.
  const withPort = /^([^:]+):\d+$/.exec(trimmed);
  return withPort ? (withPort[1] as string) : withoutZone(trimmed);
}

const withoutZone = (ip: string): string => ip.split('%', 1)[0] as string;

// The eight 16-bit groups of an IPv6 address that isIP() has accepted.
function ipv6Groups(ip: string): number[] {
  // A dotted tail stands for the last two groups.
  const dotted = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  const text = dotted
    ? `${dotted[1]}${((Number(dotted[2]) << 8) | Number(dotted[3])).toString(16)}:${((Number(dotted[4]) << 8) | Number(dotted[5])).toString(16)}`
    : ip;
  const [head = '', tail] = text.split('::');
  const parse = (part: string) => (part ? part.split(':').map((group) => parseInt(group, 16)) : []);
  const before = parse(head);
  const after = tail === undefined ? [] : parse(tail);
  return [...before, ...Array<number>(Math.max(0, 8 - before.length - after.length)).fill(0), ...after];
}
