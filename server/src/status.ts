import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import type { Live } from './live';
import { methodAllowed, notFound, pathOf, send } from './http';
import type { Stats } from './stats';

// The status port, for the operator (docs/architecture.md#status). It has a port of its own,
// STATUS_PORT, which listens on 127.0.0.1 whatever HOST says, so only the server's own machine can
// reach it: whatever stands in front of the server, such as a reverse proxy, leads to the game's
// port alone. That is why it needs no password. It gives data alone, as JSON, and nothing else:
// `/status.json` the numbers (stats.ts), which name nobody, and `/live.json` who is connected and
// who is in each room this moment, by account id and never by name (live.ts). Both are worked out
// for each request, and neither is logged or kept. How the operator shows them is up to the
// operator's own tools; the feedback and the reports are read with admin.cjs.

export const STATUS_HOST = '127.0.0.1';

// The names of this machine, with any port or none, which is what a client on this machine sends,
// on whatever local port it reaches the status port through. Any other Host header means that a
// page elsewhere has pointed a name of its own at this address, to read the data through a
// browser on this machine (DNS rebinding); the name is what stops that, not the port.
const OWN_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i;

const ownHost = (req: IncomingMessage): boolean => OWN_HOST.test(req.headers.host ?? '');

// 421 Misdirected Request, with nothing in it, for a request whose Host isn't this machine's.
function misdirected(res: ServerResponse): void {
  res.statusCode = 421;
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

// The answers are data, which load nothing and can't be framed.
const CSP = "default-src 'none'; frame-ancestors 'none'";

type Log = (event: string, fields?: Record<string, unknown>) => void;

export function createStatusHandler(stats: () => Stats, live: () => Live, log: Log): RequestListener {
  return (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', CSP);
    try {
      if (!ownHost(req)) {
        misdirected(res);
      } else if (methodAllowed(req, res)) {
        const path = pathOf(req.url ?? '/');
        if (path === '/status.json') {
          send(res, 200, 'application/json', JSON.stringify(stats()));
        } else if (path === '/live.json') {
          send(res, 200, 'application/json', JSON.stringify(live()));
        } else {
          notFound(res);
        }
      }
    } catch (error) {
      // Counting throws when the system does (stats.ts). The data is the operator's alone, and an
      // error in it must not end the game for everyone, which an error thrown from here would.
      log('error', { where: 'status', message: error instanceof Error ? error.message : String(error) });
      if (res.headersSent) res.destroy();
      else send(res, 500, 'text/plain; charset=utf-8', 'Internal server error\n');
    }
  };
}
