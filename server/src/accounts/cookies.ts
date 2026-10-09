import type { IncomingHttpHeaders } from 'node:http';

// The login cookie (docs/architecture.md). It holds the login's secret, and only the server reads
// it: HttpOnly keeps it from the page's scripts, SameSite=Lax keeps other sites' requests from
// carrying it, and Secure keeps it off plain HTTP. With Secure, its name has the __Host- prefix,
// which also keeps any other host under the same domain from setting it. Plain HTTP, as in
// development, gets a cookie without either.

const SECURE_NAME = '__Host-r2s';
const PLAIN_NAME = 'r2s';
// A login ends on the server after 30 days without use and after a year in any case
// (store/sessions.ts); the cookie lasts the year.
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const nameFor = (secure: boolean) => (secure ? SECURE_NAME : PLAIN_NAME);
const attributes = (secure: boolean) => `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

export const loginCookie = (secret: string, secure: boolean): string =>
  `${nameFor(secure)}=${secret}; Max-Age=${MAX_AGE_SECONDS}; ${attributes(secure)}`;

export const clearedCookie = (secure: boolean): string => `${nameFor(secure)}=; Max-Age=0; ${attributes(secure)}`;

// The secret in a request's login cookie, or null. A browser sends at most one cookie of a name
// for a path; should there be more, the first counts.
export function readLoginCookie(headers: IncomingHttpHeaders, secure: boolean): string | null {
  const name = nameFor(secure);
  for (const part of (headers.cookie ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator !== -1 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

// Whether a request comes from a page of this site (docs/architecture.md). A browser says where a
// request comes from in Origin, which it sends with every POST and every WebSocket, and in
// Sec-Fetch-Site; a request from another site is refused, and so is one from an opaque origin,
// such as a sandboxed frame. A request that says neither, such as a polling request of the
// page's own Socket.IO, comes from no other site that could make a browser send it.
export function fromThisSite(headers: IncomingHttpHeaders): boolean {
  const { origin, host } = headers;
  if (origin !== undefined) {
    try {
      return host !== undefined && new URL(origin).host.toLowerCase() === host.toLowerCase();
    } catch {
      return false;
    }
  }
  const site = headers['sec-fetch-site'];
  return site === undefined || site === 'same-origin';
}
