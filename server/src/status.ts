import type { RequestListener, ServerResponse } from 'node:http';
import type { History, Stats } from './stats';
import { renderStatusPage } from './statusPage';

// The status page for the operator (docs/architecture.md). It has a port of its own, STATUS_PORT,
// which listens on 127.0.0.1 whatever HOST says, so only the server's own machine can reach it:
// the tunnel and any reverse proxy lead to the game's port alone. That is why it needs no
// password. `/` is the page and `/status.json` the same numbers for scripts. Both are read-only.

export const STATUS_HOST = '127.0.0.1';

// The names of this machine. Any other Host header means that a page elsewhere has pointed a
// name of its own at 127.0.0.1, to read the status through a browser on this machine.
const LOCAL = /^(localhost|127\.0\.0\.1)(:\d{1,5})?$/i;

// The page loads nothing and runs no script.
const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(body);
}

const notFound = (res: ServerResponse) => send(res, 404, 'text/plain; charset=utf-8', 'Not found\n');

export function createStatusHandler(stats: () => Stats, history: History): RequestListener {
  return (req, res) => {
    const path = (req.url ?? '/').split('?', 1)[0];
    if (!LOCAL.test(req.headers.host ?? '')) {
      notFound(res);
    } else if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed\n');
    } else if (path === '/') {
      res.setHeader('Content-Security-Policy', CSP);
      send(res, 200, 'text/html; charset=utf-8', renderStatusPage(stats(), history.samples()));
    } else if (path === '/status.json') {
      send(res, 200, 'application/json', JSON.stringify(stats()));
    } else {
      notFound(res);
    }
  };
}
