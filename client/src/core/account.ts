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

// Asks the server who this browser is.
export async function loadAccount(): Promise<void> {
  const reply = await request<AccountState>(ACCOUNT_API.account);
  if (reply.ok) Object.assign(account, { summary: reply.account, mail: reply.mail });
  account.loaded = true;
}

// After a login, a logout or anything else that changes who this browser is: the page learns it,
// and its connection is made again, so that the server knows it there too.
export async function loggedInOrOut(): Promise<void> {
  await loadAccount();
  if (connection.everConnected) reconnect();
}

// Logs in or registers, and makes sure that the browser kept the cookie: one that refuses cookies,
// as some private modes do, can't stay logged in.
export async function logIn(path: string, body: object): Promise<Ack> {
  const reply = await request(path, body);
  if (!reply.ok) return reply;
  await loggedInOrOut();
  return account.summary ? reply : { ok: false, error: 'cookies_blocked' };
}

// A connection whose login ended elsewhere, as when the password was reset, is told so and closed
// by the server. It comes back as a guest.
let endedHere = false;
socket.on('account:ended', () => {
  endedHere = true;
  account.summary = null;
});
socket.on('disconnect', (reason) => {
  if (!endedHere || reason !== 'io server disconnect') return;
  endedHere = false;
  reconnect();
});

// Every connection hears who it is. When that isn't what the page thinks, as after a rename in
// another tab, the page asks again.
socket.on('session', ({ account: connected }: Session) => {
  if (!account.loaded) return;
  const { summary } = account;
  if (
    (connected?.username ?? null) !== (summary?.username ?? null) ||
    (connected?.avatar ?? null) !== (summary?.avatar ?? null)
  ) {
    void loadAccount();
  }
});
