import { ACCOUNT_API, type Ack, type AccountState, type AccountSummary, type Session } from '@reviewer2/shared';
import { reactive } from 'vue';
import { connection, reconnect, socket } from './socket';

// The account that this browser is logged in to, as the server last said (docs/architecture.md),
// and the requests of the account API. The login itself is a cookie that the page never sees: the
// server sets and clears it, and only its answers say who the browser is.

export const account = reactive<{
  // Whether the server has said yet.
  loaded: boolean;
  summary: AccountSummary | null;
  // Whether accounts have email on this server.
  mail: boolean;
}>({ loaded: false, summary: null, mail: false });

const TIMEOUT_MS = 10_000;

// A request to the account API, answered as the messages are, with { ok, ... } or { ok: false,
// error }. One that gets no answer fails with offline or timeout, and one whose answer can't be
// read with unknown. A body that is a Blob, such as an avatar, goes as it is, with its type.
export async function request<Data extends object = object>(path: string, body?: object | Blob): Promise<Ack<Data>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const image = body instanceof Blob;
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': image ? body.type : 'application/json' },
      ...(body === undefined ? {} : { body: image ? body : JSON.stringify(body) }),
      signal: controller.signal,
    });
    try {
      return (await response.json()) as Ack<Data>;
    } catch {
      return { ok: false, error: 'unknown' };
    }
  } catch {
    return { ok: false, error: controller.signal.aborted ? 'timeout' : 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

// Whom the connection was last told it belongs to, by username, null for a guest, or undefined
// while it hasn't been told, as before it is made and after it drops.
let connectedAs: string | null | undefined;

// Asks the server who this browser is, and says whether it answered. When it didn't, the page keeps
// what it last knew. A connection that was made as someone else, as when the player logged in or
// out in another tab, is made again, so that the server knows there too who the browser is: what
// it sends, such as feedback, goes by the connection.
export async function loadAccount(): Promise<boolean> {
  const reply = await request<AccountState>(ACCOUNT_API.account);
  if (reply.ok) {
    Object.assign(account, { summary: reply.account, mail: reply.mail });
    if (connectedAs !== undefined && connectedAs !== (reply.account?.username ?? null)) reconnect();
  }
  account.loaded = true;
  return reply.ok;
}

// After a login, a logout or anything else that changes who this browser is: the page learns it,
// and its connection is made again, so that the server knows it there too, which loadAccount()
// does once the connection has said whom it was made for, and this does before. Says whether the
// server answered the question.
export async function loggedInOrOut(): Promise<boolean> {
  const answered = await loadAccount();
  if (connection.everConnected && connectedAs === undefined) reconnect();
  return answered;
}

// A request that changes who this browser is: a login or a registration, a password change or
// reset, a logout, or the deletion of the account. The server ends the login that the browser had,
// and tells the browser's connections so (account:ended, below) before its answer sets or clears
// the cookie. The page must not act on that word before the answer has come: asking who it is, or
// connecting again, with the cookie as it was would make the browser a guest, and the answer to
// that question might even arrive after the one that set the new cookie. So while such a request
// is out, the word is kept, and the page learns who it is from the answer.
let changing = 0;
let endedMeanwhile = false;

export async function changeLogin<Data extends object = object>(
  path: string,
  body: object,
): Promise<{ reply: Ack<Data>; answered: boolean }> {
  changing += 1;
  let reply: Ack<Data>;
  try {
    reply = await request<Data>(path, body);
  } finally {
    changing -= 1;
  }
  let answered = false;
  if (reply.ok || endedMeanwhile) {
    endedMeanwhile = false;
    answered = await loggedInOrOut();
  }
  return { reply, answered };
}

// Logs in or registers, and makes sure that the browser kept the cookie: one that refuses cookies,
// as some private modes do, can't stay logged in. Only the server can say so; when it didn't answer
// the question, the login stands as the server granted it.
export async function logIn(path: string, body: object): Promise<Ack> {
  const { reply, answered } = await changeLogin(path, body);
  if (!reply.ok) return reply;
  return answered && !account.summary ? { ok: false, error: 'cookies_blocked' } : reply;
}

// A connection whose login ended, as when the password was changed or reset, is told so and closed
// by the server. It comes back as whoever the browser is now: a guest, or the same account with
// the new login of the browser that changed the password, which the page asks the server about,
// unless the page itself asked for the change, and waits for the answer instead (changeLogin).
let endedHere = false;
socket.on('account:ended', () => {
  if (changing > 0) {
    endedMeanwhile = true;
    return;
  }
  endedHere = true;
  void loadAccount();
});
socket.on('disconnect', (reason) => {
  connectedAs = undefined;
  if (!endedHere || reason !== 'io server disconnect') return;
  endedHere = false;
  reconnect();
});

// Every connection hears who it is. When that isn't what the page thinks, as after a rename in
// another tab, the page asks again.
socket.on('session', ({ account: connected }: Session) => {
  connectedAs = connected?.username ?? null;
  if (!account.loaded) return;
  const { summary } = account;
  if (
    (connected?.username ?? null) !== (summary?.username ?? null) ||
    (connected?.avatar ?? null) !== (summary?.avatar ?? null)
  ) {
    void loadAccount();
  }
});
