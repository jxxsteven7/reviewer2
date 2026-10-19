import { existsSync } from 'node:fs';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { CONTRIBUTIONS_API, LANGUAGES, LIST_API, type Contribution, type ListName } from '@reviewer2/shared';
import sirv from 'sirv';
import type { ThanksLists } from './thanks';

// HTTP for everything that isn't Socket.IO: the built front end, with the SPA fallback to
// index.html for routes such as /room/K7QX, /healthz, the lists of thanks and the feedback
// contributions for the home page (thanks.ts, store/feedback.ts), and the account API under /api
// with the avatars under /avatars
// (accounts/http.ts). docs/architecture.md describes what it answers and why; the reasons for each
// header are also beside the code that sets it.

export interface HttpOptions {
  publicDir: string;
  version: string;
  lists: ThanksLists;
  // The feedback contributions, as anyone may see them, read from the database at each request.
  contributions: () => Contribution[];
  // Answers the paths that it knows, the account API's, and says whether it did.
  accounts?: (req: IncomingMessage, res: ServerResponse, path: string) => boolean;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

const LISTS = new Map<string, ListName>(Object.entries(LIST_API).map(([name, path]) => [path, name as ListName]));

// A Host header we're willing to repeat in the CSP: a host name or IP address and a port.
const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;

// The Content Security Policy, except for connect-src, which names the host of each request.
const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function setSecurityHeaders(req: IncomingMessage, res: ServerResponse): void {
  // 'self' covers WebSocket connections to the same host in current browsers, but WebKit only
  // learned that in 2022, so older iOS in-app browsers need the ws:// and wss:// origins spelled out.
  const host = req.headers.host;
  const sockets = host && HOST.test(host) ? ` ws://${host} wss://${host}` : '';
  res.setHeader('Content-Security-Policy', `${CSP}; connect-src 'self'${sockets}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
}

// The answers that this handler and the status port's (status.ts) have in common.

export function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

export const notFound = (res: ServerResponse) => send(res, 404, 'text/plain; charset=utf-8', 'Not found\n');

// Everything the server answers over plain HTTP, but the account API, is read-only. A request by
// any method but GET and HEAD is answered with 405 here, and false says so. sirv would otherwise
// answer a stray POST with the file or the page, as if it had done something.
export function methodAllowed(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  res.setHeader('Allow', 'GET, HEAD');
  send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed\n');
  return false;
}

// The path of a request target: everything before the query string, as sirv reads it too. Not
// new URL(), which takes a target that starts with two slashes for a host name and throws when
// that isn't one. Nothing would catch that error, so "GET //" alone would end the process.
export function pathOf(target: string): string {
  const query = target.indexOf('?');
  return query === -1 ? target : target.slice(0, query);
}

const NOT_BUILT = 'The front end has not been built. Run npm run build and restart the server, or use npm run dev.\n';

// Answers a GET with the JSON that `body` makes, or with 500 when it throws: an error there would
// otherwise end the process, since nothing else catches it. `where` names the answer in the log.
function answerJson(
  req: IncomingMessage,
  res: ServerResponse,
  where: string,
  body: () => string,
  log?: HttpOptions['log'],
): void {
  if (!methodAllowed(req, res)) return;
  try {
    send(res, 200, 'application/json', body());
  } catch (error) {
    log?.('error', { where, message: error instanceof Error ? error.message : String(error) });
    send(res, 500, 'application/json', JSON.stringify({ ok: false, error: 'internal' }));
  }
}

export function createRequestHandler({
  publicDir,
  version,
  lists,
  contributions,
  accounts,
  log,
}: HttpOptions): RequestListener {
  const startedAt = Date.now();
  // sirv lists the files when it starts, so it only serves the front end that was built then.
  // A new build needs a restart: until then, a new index.html would name assets sirv doesn't know.
  const files = existsSync(publicDir) ? staticFiles(publicDir) : null;
  const pages = languagePages(publicDir);

  return (req, res) => {
    setSecurityHeaders(req, res);
    const path = pathOf(req.url ?? '/');
    const list = LISTS.get(path);
    if (list !== undefined) {
      answerJson(req, res, 'lists', () => lists.answer(list), log);
      return;
    }
    if (path === CONTRIBUTIONS_API) {
      answerJson(req, res, 'contributions', () => JSON.stringify({ ok: true, contributions: contributions() }), log);
      return;
    }
    if (accounts?.(req, res, path)) return;
    // Socket.IO's own requests, POSTs included, never reach this handler.
    if (!methodAllowed(req, res)) return;
    if (path === '/healthz') {
      const uptime = Math.round((Date.now() - startedAt) / 1000);
      send(res, 200, 'application/json', JSON.stringify({ ok: true, version, uptime }));
    } else if (!files) {
      send(res, 404, 'text/plain; charset=utf-8', NOT_BUILT);
    } else {
      const page = pages.get(languageAsked(req.url ?? '/') ?? '');
      if (page) req.url = page;
      files(req, res, () => notFound(res));
    }
  };
}

const ASSETS = '/assets/';

// The home page opened in a language, /?lang=en, is sent as the copy of index.html whose head is in
// that language alone, so that a link's preview shows that language (pageIn in
// client/src/core/site.ts names the copies; the app reads the query itself). Maps each language to
// the path of its copy, if the build wrote one; without it, the page is index.html.
function languagePages(publicDir: string): Map<string, string> {
  return new Map(
    LANGUAGES.filter((language) => existsSync(join(publicDir, `index.${language}.html`))).map((language) => [
      language,
      `/index.${language}.html`,
    ]),
  );
}

// The language that a request for the home page asks for in its query, if it asks for one: the app
// ignores a query that names several, and so does this.
function languageAsked(target: string): string | null {
  if (pathOf(target) !== '/') return null;
  const query = target.indexOf('?');
  const asked = query < 0 ? [] : new URLSearchParams(target.slice(query + 1)).getAll('lang');
  return asked.length === 1 ? (asked[0] ?? null) : null;
}

// The front end, with every route that isn't a file falling back to index.html. A missing asset
// is a 404 rather than the page, so that a stale page fails visibly: sirv falls back for no path
// under /assets/, and for no path that ends in an extension.
//
// Only file names with a content hash, which Vite puts in /assets/, may be cached for good.
// Everything else, index.html included, must be checked again on every visit, or a browser
// that cached an old page would ask for assets that a new build no longer has. sirv passes
// setHeaders the requested path, not index.html, when it falls back to index.html.
//
// sirv doesn't compress anything itself. With gzip and brotli on, it sends the .gz or .br copy
// that the build leaves beside each text file (client/compress.mjs) to the browsers that accept it.
//
// sirv names no type for favicon.ico, which its list of types lacks, and with nosniff a file
// should have one; the type set here is the one sirv sends.
function staticFiles(publicDir: string) {
  return sirv(publicDir, {
    etag: true,
    gzip: true,
    brotli: true,
    single: true,
    ignores: [`^${ASSETS}`],
    setHeaders: (res, path) => {
      res.setHeader('Cache-Control', path.startsWith(ASSETS) ? 'public, max-age=31536000, immutable' : 'no-cache');
      if (path.endsWith('.ico')) res.setHeader('Content-Type', 'image/x-icon');
    },
  });
}
