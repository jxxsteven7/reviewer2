import type { IncomingHttpHeaders } from 'node:http';

// The address that rate limits count against. Behind a reverse proxy every connection comes from
// the proxy, so with TRUST_PROXY set the address is the last entry of X-Forwarded-For, the one
// that the proxy itself added. IPv6 addresses are grouped by their /64 network, since one
// household or phone usually gets a whole /64.
export function clientIp(address: string, headers: IncomingHttpHeaders, trustProxy: boolean): string {
  let ip = address;
  if (trustProxy) {
    const forwarded = headers['x-forwarded-for'];
    const last = (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? ''))
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .at(-1);
    if (last) ip = last;
  }
  return groupIp(ip);
}

export function groupIp(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1] as string;
  if (!ip.includes(':')) return ip;
  const [head = '', tail = ''] = ip.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const groups = ip.includes('::')
    ? [...headGroups, ...Array<string>(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill('0'), ...tailGroups]
    : headGroups;
  return `${groups
    .slice(0, 4)
    .map((group) => group.toLowerCase().replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}
