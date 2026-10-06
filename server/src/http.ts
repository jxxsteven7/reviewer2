import { existsSync } from 'node:fs';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import sirv from 'sirv';

// HTTP for everything that isn't Socket.IO: the built front end, with the SPA fallback to
// index.html for routes such as /room/K7QX, and /healthz. docs/architecture.md explains the
// cache and security headers.

export interface HttpOptions {
  publicDir: string;
  version: string;
  startedAt?: number;
}

// A Host header we're willing to repeat in the CSP: a host name or IP address and a port.
const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;

function setSecurityHeaders(req: IncomingMessage, res: ServerResponse): void {
  // 'self' covers WebSocket connections to the same host in current browsers, but WebKit only
  // learned that in 2022, so older iOS in-app browsers need the ws:// and wss:// origins spelled out.
  const host = req.headers.host;
  const sockets = host && HOST.test(host) ? ` ws://${host} wss://${host}` : '';
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      `connect-src 'self'${sockets}`,
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

const notFound = (res: ServerResponse) => send(res, 404, 'text/plain; charset=utf-8', 'Not found\n');

const NOT_BUILT = 'The front end has not been built. Run npm run build, or use npm run dev.\n';

export function createRequestHandler({ publicDir, version, startedAt = Date.now() }: HttpOptions): RequestListener {
  // sirv lists the files when it starts, so it can only serve a front end that has been built.
  const files = existsSync(publicDir) ? staticFiles(publicDir) : null;

  return (req, res) => {
    setSecurityHeaders(req, res);
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/healthz') {
      const uptime = Math.round((Date.now() - startedAt) / 1000);
      send(res, 200, 'application/json', JSON.stringify({ ok: true, version, uptime }));
    } else if (!files) {
      send(res, 404, 'text/plain; charset=utf-8', NOT_BUILT);
    } else if (path.startsWith('/assets/')) {
      // A missing asset is a 404, not index.html, so that a stale page fails visibly.
      files.assets(req, res, () => notFound(res));
    } else {
      files.pages(req, res, () => notFound(res));
    }
  };
}

// Only file names with a content hash, which Vite puts in /assets/, may be cached for good.
// Everything else, index.html included, must be checked again on every visit, or a browser
// that cached an old page would ask for assets that a new build no longer has. sirv passes
// setHeaders the requested path, not index.html, when it falls back to index.html.
function staticFiles(publicDir: string) {
  return {
    assets: sirv(publicDir, {
      etag: true,
      setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'),
    }),
    pages: sirv(publicDir, {
      etag: true,
      single: true,
      setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
    }),
  };
}
