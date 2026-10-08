import type { RequestListener } from 'node:http';
import { methodAllowed, notFound, pathOf, send } from './http';
import type { History, Stats } from './stats';
import { renderStatusPage, type FeedbackListing } from './statusPage';
import type { FeedbackStore } from './store/feedback';

// The status page for the operator (docs/architecture.md). It has a port of its own, STATUS_PORT,
// which listens on 127.0.0.1 whatever HOST says, so only the server's own machine can reach it:
// the tunnel and any reverse proxy lead to the game's port alone. That is why it needs no
// password. `/` is the page and `/status.json` the same numbers for scripts. Both are read-only.
// The page also shows the feedback that players sent, a page of it at a time: `/?before=<id>`
// shows what came before that one.

export const STATUS_HOST = '127.0.0.1';

// The names of this machine. Any other Host header means that a page elsewhere has pointed a
// name of its own at 127.0.0.1, to read the status through a browser on this machine.
const LOCAL = /^(localhost|127\.0\.0\.1)(:\d{1,5})?$/i;

// The page loads nothing and runs no script.
const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

type Log = (event: string, fields?: Record<string, unknown>) => void;

// How much feedback the page shows at a time. The page reloads every 5 seconds, so it is never
// all of it.
export const FEEDBACK_SHOWN = 50;

// The feedback for the page, before the id in the query when it has one, and whether there is
// more before that. A query that isn't a number is taken for none.
function feedbackListing(feedback: FeedbackStore, target: string): FeedbackListing {
  const query = new URLSearchParams(target.slice(pathOf(target).length));
  const before = /^\d{1,15}$/.test(query.get('before') ?? '') ? Number(query.get('before')) : undefined;
  const entries = feedback.latest(FEEDBACK_SHOWN + 1, before);
  return {
    total: feedback.count(),
    entries: entries.slice(0, FEEDBACK_SHOWN),
    paged: before !== undefined,
    older: entries.length > FEEDBACK_SHOWN,
  };
}

export function createStatusHandler(
  stats: () => Stats,
  history: History,
  feedback: FeedbackStore,
  log: Log,
): RequestListener {
  return (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (!LOCAL.test(req.headers.host ?? '')) {
        notFound(res);
      } else if (methodAllowed(req, res)) {
        const target = req.url ?? '/';
        const path = pathOf(target);
        if (path === '/') {
          res.setHeader('Content-Security-Policy', CSP);
          const page = renderStatusPage(stats(), history.samples(), history.now(), feedbackListing(feedback, target));
          send(res, 200, 'text/html; charset=utf-8', page);
        } else if (path === '/status.json') {
          send(res, 200, 'application/json', JSON.stringify(stats()));
        } else {
          notFound(res);
        }
      }
    } catch (error) {
      // Counting throws when the system does (stats.ts), and reading the feedback when the
      // database does. The page is the operator's alone, and an error in it must not end the game
      // for everyone, which an error thrown from here would.
      log('error', { where: 'status', message: error instanceof Error ? error.message : String(error) });
      if (res.headersSent) res.destroy();
      else send(res, 500, 'text/plain; charset=utf-8', 'Internal server error\n');
    }
  };
}
