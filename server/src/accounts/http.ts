import type { IncomingMessage, ServerResponse } from 'node:http';
import { ACCOUNT_API, type AccountState } from '@reviewer2/shared';
import { ACCOUNT_REQUESTS } from '@reviewer2/shared/schemas';
import type { z } from 'zod';
import { clientIp } from '../core/clientIp';
import { clearedCookie, fromThisSite, loginCookie, readLoginCookie } from './cookies';
import type { AccountFailure, AccountResult, Accounts, Login } from './service';

// The account API over HTTP (docs/architecture.md): JSON under /api, answered with { ok: true, ... }
// or { ok: false, error } as the messages are, and with a status code that says the same. It is
// HTTP rather than Socket.IO because only an HTTP response can set the login cookie, which the
// page's scripts never see.
//
// Every request that changes something must come from a page of this site (cookies.ts), with a
// body of JSON, which a form on another site can't send without asking first, and which the
// server never allows. Each address may make so many of them a minute (limits.ts).

type Log = (event: string, fields?: Record<string, unknown>) => void;

export interface AccountApiOptions {
  accounts: Accounts;
  // Whether the login cookie is Secure, which it is unless the server is told that it is served
  // over plain HTTP (COOKIE_SECURE=0).
  secureCookies: boolean;
  trustProxy: boolean;
  log: Log;
}

// The largest body of JSON that is read.
export const MAX_JSON_BODY = 4096;
// How long a body may take to arrive.
const BODY_MS = 5_000;

const STATUS: Partial<Record<AccountFailure, number>> = {
  bad_request: 400,
  bad_origin: 403,
  not_logged_in: 401,
  login_failed: 401,
  password_wrong: 401,
  link_invalid: 400,
  username_taken: 409,
  rate_limited: 429,
  login_limited: 429,
  register_limited: 429,
  email_limited: 429,
  avatar_limited: 429,
  avatar_banned: 403,
  avatar_too_large: 413,
  busy: 503,
  mail_unavailable: 503,
  storage_full: 503,
  avatars_full: 503,
  internal: 500,
};

interface Answer {
  status: number;
  body: object;
  cookie?: string;
}

const ok = (body: object = {}, cookie?: string): Answer => ({ status: 200, body: { ok: true, ...body }, cookie });
const failure = (error: AccountFailure): Answer => ({ status: STATUS[error] ?? 400, body: { ok: false, error } });
const fromResult = (result: AccountResult, cookie?: string): Answer =>
  result.ok ? ok({}, cookie) : failure(result.error);

interface Request<Body> {
  ip: string;
  login: Login | null;
  body: Body;
}

type Route = {
  method: 'GET' | 'POST';
  // The schema of a JSON body; none for GET.
  schema?: z.ZodType;
  // Whether the request needs a login.
  login?: boolean;
  handle(request: Request<never>): Answer | Promise<Answer>;
};

// A route whose body has the type of its schema.
function post<Schema extends z.ZodType>(
  schema: Schema,
  handle: (request: Request<z.infer<Schema>>) => Answer | Promise<Answer>,
  login = false,
): Route {
  return { method: 'POST', schema, login, handle: handle as Route['handle'] };
}

export function createAccountApi({ accounts, secureCookies, trustProxy, log }: AccountApiOptions) {
  const signedIn = (secret: string) => loginCookie(secret, secureCookies);
  const signedOut = clearedCookie(secureCookies);
  const state = (login: Login | null): AccountState => ({
    account: login ? accounts.summary(login.account) : null,
    mail: false,
  });

  const routes: Record<string, Route> = {
    [ACCOUNT_API.account]: { method: 'GET', handle: ({ login }) => ok(state(login)) },
    [ACCOUNT_API.records]: {
      method: 'GET',
      login: true,
      handle: ({ login }) => ok({ records: accounts.recordsOf(login as Login) }),
    },
    [ACCOUNT_API.register]: post(ACCOUNT_REQUESTS.register, async ({ ip, login, body }) => {
      const result = await accounts.register(ip, body.username, body.password);
      if (!result.ok) return failure(result.error);
      // A browser that was logged in to another account is logged out of it.
      if (login) accounts.logOut(login);
      return ok({}, signedIn(result.secret));
    }),
    [ACCOUNT_API.login]: post(ACCOUNT_REQUESTS.login, async ({ ip, login, body }) => {
      const result = await accounts.logIn(ip, body.username, body.password, login);
      return result.ok ? ok({}, signedIn(result.secret)) : failure(result.error);
    }),
    [ACCOUNT_API.logout]: post(ACCOUNT_REQUESTS.logout, ({ login }) => {
      if (login) accounts.logOut(login);
      return ok({}, signedOut);
    }),
    [ACCOUNT_API.username]: post(
      ACCOUNT_REQUESTS.username,
      ({ login, body }) => fromResult(accounts.rename(login as Login, body.username)),
      true,
    ),
    [ACCOUNT_API.password]: post(
      ACCOUNT_REQUESTS.password,
      async ({ ip, login, body }) => {
        const result = await accounts.changePassword(ip, login as Login, body.current, body.password);
        return result.ok ? ok({}, signedIn(result.secret)) : failure(result.error);
      },
      true,
    ),
    [ACCOUNT_API.remove]: post(
      ACCOUNT_REQUESTS.remove,
      async ({ ip, login, body }) => {
        const result = await accounts.remove(ip, login as Login, body.password);
        return result.ok ? ok({}, signedOut) : failure(result.error);
      },
      true,
    ),
  };

  // Answers a request under /api, and says whether it was one.
  return function handle(req: IncomingMessage, res: ServerResponse, path: string): boolean {
    if (!path.startsWith('/api/')) return false;
    void respond(req, res, path).catch((error: unknown) => {
      log('error', { where: 'account', message: error instanceof Error ? error.message : String(error) });
      if (!res.headersSent) send(res, failure('internal'));
      else res.destroy();
    });
    return true;
  };

  async function respond(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const route = routes[path];
    if (!route) {
      send(res, { status: 404, body: { ok: false, error: 'bad_request' } });
      return;
    }
    const methods = route.method === 'GET' ? ['GET', 'HEAD'] : ['POST'];
    if (!methods.includes(req.method ?? '')) {
      res.setHeader('Allow', methods.join(', '));
      send(res, { status: 405, body: { ok: false, error: 'bad_request' } });
      return;
    }
    const ip = clientIp(req.socket.remoteAddress, req.headers, trustProxy);
    let body: unknown;
    if (route.method === 'POST') {
      if (!fromThisSite(req.headers)) return send(res, failure('bad_origin'));
      if (!accounts.counters.requests.allowed(ip)) return send(res, failure('rate_limited'));
      accounts.counters.requests.add(ip);
      if (!isJson(req)) return send(res, { status: 415, body: { ok: false, error: 'bad_request' } });
      const raw = await readBody(req, MAX_JSON_BODY);
      if (raw === 'too_large') return tooLarge(res);
      if (raw === 'unfinished') return send(res, failure('bad_request'));
      const parsed = route.schema?.safeParse(parseJson(raw));
      if (!parsed?.success) return send(res, failure('bad_request'));
      body = parsed.data;
    }
    const secret = readLoginCookie(req.headers, secureCookies);
    const login = accounts.login(secret);
    if (route.login && !login) {
      return send(res, { ...failure('not_logged_in'), ...(secret === null ? {} : { cookie: signedOut }) });
    }
    const answer = await route.handle({ ip, login, body } as Request<never>);
    // A cookie that stands for no login, as after its login has ended elsewhere, is cleared.
    send(res, secret !== null && !login && answer.cookie === undefined ? { ...answer, cookie: signedOut } : answer);
  }

  function send(res: ServerResponse, { status, body, cookie }: Answer): void {
    if (res.headersSent || res.destroyed) return;
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (cookie) res.setHeader('Set-Cookie', cookie);
    res.end(JSON.stringify(body));
  }

  // A body that is too large is not read to its end: the connection closes once the answer is out.
  function tooLarge(res: ServerResponse): void {
    res.setHeader('Connection', 'close');
    send(res, { status: 413, body: { ok: false, error: 'bad_request' } });
    res.once('finish', () => res.req.destroy());
  }
}

const isJson = (req: IncomingMessage) => /^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '');

function parseJson(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

// Reads a request's body, up to `limit` bytes, for up to 5 seconds.
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer | 'too_large' | 'unfinished'> {
  const declared = Number(req.headers['content-length']);
  if (declared > limit) return Promise.resolve('too_large');
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => finish('unfinished'), BODY_MS);
    function finish(result: Buffer | 'too_large' | 'unfinished'): void {
      clearTimeout(timer);
      req.off('data', data).off('end', end).off('error', error).off('aborted', error);
      resolve(result);
    }
    function data(chunk: Buffer): void {
      size += chunk.length;
      if (size > limit) finish('too_large');
      else chunks.push(chunk);
    }
    const end = () => finish(Buffer.concat(chunks));
    const error = () => finish('unfinished');
    req.on('data', data).on('end', end).on('error', error).on('aborted', error);
  });
}
