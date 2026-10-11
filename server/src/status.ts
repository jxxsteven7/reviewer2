import { FEEDBACK_KINDS, type FeedbackKind } from '@reviewer2/shared';
import type { RequestListener } from 'node:http';
import { methodAllowed, notFound, pathOf, send } from './http';
import type { History, Stats } from './stats';
import {
  FEEDBACK_PATH,
  renderFeedbackPage,
  renderReportsPage,
  renderStatusPage,
  REPORTS_PATH,
  type AccountCounts,
  type FeedbackListing,
  type ReportListing,
} from './statusPage';
import type { FeedbackStore } from './store/feedback';

// The status page for the operator (docs/architecture.md). It has a port of its own, STATUS_PORT,
// which listens on 127.0.0.1 whatever HOST says, so only the server's own machine can reach it:
// whatever stands in front of the server, such as a reverse proxy, leads to the game's port
// alone. That is why it needs no password. `/` is the page and `/status.json` the same numbers
// for scripts. `/feedback` is the feedback that players sent, a page of it at a time:
// `/feedback?before=<id>` shows what came before that one, and `/feedback?kind=<kind>` only the
// feedback of one kind. `/reports` is the reports that players sent of each other, paged the same
// way. All of it is read-only.

export const STATUS_HOST = '127.0.0.1';

// The names of this machine. Any other Host header means that a page elsewhere has pointed a
// name of its own at 127.0.0.1, to read the status through a browser on this machine.
const LOCAL = /^(localhost|127\.0\.0\.1)(:\d{1,5})?$/i;

// The pages load nothing and run no script.
const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

type Log = (event: string, fields?: Record<string, unknown>) => void;

// How much feedback, or how many reports, a page shows at a time.
export const FEEDBACK_SHOWN = 50;

// The id in the query that a page goes back from, or undefined. One that isn't a number is taken
// for none.
const beforeIn = (query: URLSearchParams): number | undefined =>
  /^\d{1,15}$/.test(query.get('before') ?? '') ? Number(query.get('before')) : undefined;

// The feedback for the page, before the id in the query when it has one and of the kind in it
// when it has one, and whether there is more before that. A query that isn't a number, or a kind
// that the server doesn't know, is taken for none.
function feedbackListing(feedback: FeedbackStore, target: string): FeedbackListing {
  const query = new URLSearchParams(target.slice(pathOf(target).length));
  const before = beforeIn(query);
  const asked = query.get('kind') ?? '';
  const kind = (FEEDBACK_KINDS as readonly string[]).includes(asked) ? (asked as FeedbackKind) : null;
  const entries = feedback.latest(FEEDBACK_SHOWN + 1, before, kind);
  return {
    total: feedback.count(),
    kinds: feedback.kinds(),
    kind,
    entries: entries.slice(0, FEEDBACK_SHOWN),
    paged: before !== undefined,
    older: entries.length > FEEDBACK_SHOWN,
  };
}

// The reports for the page, paged as the feedback is.
function reportListing(feedback: FeedbackStore, target: string): ReportListing {
  const before = beforeIn(new URLSearchParams(target.slice(pathOf(target).length)));
  const entries = feedback.reports(FEEDBACK_SHOWN + 1, before);
  return {
    total: feedback.reportCount(),
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
  // How many accounts there are, and how many are new.
  accounts: () => AccountCounts = () => ({ total: 0, recent: 0 }),
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
          const page = renderStatusPage(
            stats(),
            history.samples(),
            history.now(),
            feedback.count(),
            accounts(),
            feedback.reportCount(),
          );
          send(res, 200, 'text/html; charset=utf-8', page);
        } else if (path === FEEDBACK_PATH) {
          res.setHeader('Content-Security-Policy', CSP);
          send(res, 200, 'text/html; charset=utf-8', renderFeedbackPage(feedbackListing(feedback, target)));
        } else if (path === REPORTS_PATH) {
          res.setHeader('Content-Security-Policy', CSP);
          send(res, 200, 'text/html; charset=utf-8', renderReportsPage(reportListing(feedback, target)));
        } else if (path === '/status.json') {
          send(res, 200, 'application/json', JSON.stringify(stats()));
        } else {
          notFound(res);
        }
      }
    } catch (error) {
      // Counting throws when the system does (stats.ts), and reading the feedback when the
      // database does. The pages are the operator's alone, and an error in them must not end the
      // game for everyone, which an error thrown from here would.
      log('error', { where: 'status', message: error instanceof Error ? error.message : String(error) });
      if (res.headersSent) res.destroy();
      else send(res, 500, 'text/plain; charset=utf-8', 'Internal server error\n');
    }
  };
}
