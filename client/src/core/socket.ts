import type { Ack, Handshake, Session } from '@reviewer2/shared';
import { io } from 'socket.io-client';
import { computed, reactive } from 'vue';
import { storedToken, storeToken } from './session';
import { toastError } from './toast';

// The page's one Socket.IO connection (docs/architecture.md).
//
// Phones drop the connection whenever the screen locks, and often don't notice when they come
// back. So whenever the page becomes visible again, comes back from the browser's cache or gets
// its network back, the client pings the server, and reconnects at once if nobody answers.
// Nothing is sent while disconnected, and anything Socket.IO queued in the meantime is dropped:
// a move meant for a moment that has passed must not arrive late.

// The room this page is in. It goes with every handshake, so that a reconnecting player is put
// back into their room before anything else they send is handled.
const handshake: Handshake = {};

export const socket = io({
  autoConnect: false,
  auth: (callback) => callback({ ...handshake, ...(storedToken() ? { token: storedToken() } : {}) }),
});

// `connects` counts the connections the page has made, so that what comes with a new one, such as
// the snapshot that catches a page up after a locked screen, can be told from what happens live.
// `busy` says that the server turned the page's last try away as too busy.
export const connection = reactive({ connected: false, everConnected: false, connects: 0, busy: false });

// How long a page that a busy server turned away waits before it tries again, and as long again at
// most on top, so that the pages turned away together don't all come back together.
export const BUSY_RETRY_MS = 30_000;
let busyRetry: ReturnType<typeof setTimeout> | undefined;

// Whether the page has lost its connection and is getting it back. A room's page then shows the
// "Reconnecting..." banner (ConnectionBanner), and what sticks to the top of the screen keeps
// below it: the short messages, and a game's clock.
export const reconnecting = computed(() => connection.everConnected && !connection.connected);

socket.on('connect', () => {
  connection.connected = true;
  connection.everConnected = true;
  connection.connects += 1;
  connection.busy = false;
  clearTimeout(busyRetry);
});

// A busy server turns away a connection that doesn't come back to a room, before it is made
// (docs/architecture.md#limits-and-housekeeping). The page says so, as it shows any other error,
// once until it gets in; answers whatever it is asked to send with the same; and tries again by
// itself, since Socket.IO doesn't after such a refusal. Any other failure is Socket.IO's to try
// again, and the page is offline.
socket.on('connect_error', (error) => {
  clearTimeout(busyRetry);
  if (error.message !== 'server_busy') {
    connection.busy = false;
    return;
  }
  if (!connection.busy) toastError('server_busy');
  connection.busy = true;
  busyRetry = setTimeout(connect, BUSY_RETRY_MS * (1 + Math.random()));
});

socket.on('disconnect', () => {
  connection.connected = false;
  socket.sendBuffer.length = 0;
});

socket.on('session', ({ token, version }: Session) => {
  if (token) storeToken(token);
  reloadIfOutdated(version);
});

export function setHandshake(next: Handshake): void {
  for (const key of Object.keys(handshake) as (keyof Handshake)[]) delete handshake[key];
  Object.assign(handshake, next);
}

export function connect(): void {
  if (!socket.connected && !socket.active) socket.connect();
}

// Runs something once there is a connection: now, if there is one, or else when the next one
// comes, which is asked for. Returns a way to call it off, for a page that goes away first.
export function onceConnected(run: () => void): () => void {
  if (socket.connected) {
    run();
    return () => {};
  }
  socket.once('connect', run);
  connect();
  return () => socket.off('connect', run);
}

// Whether there is a connection within so long, asked for if there is none yet: for a page that
// may have none, such as a player's page, before it sends a message that goes over one.
export function whenConnected(ms = 5000): Promise<boolean> {
  if (socket.connected) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      off();
      resolve(false);
    }, ms);
    const off = onceConnected(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

// Makes a fresh connection now. A connection that Socket.IO is waiting to retry would otherwise
// keep waiting: connect() alone does nothing while a retry is pending, and the pauses between
// retries grow to several seconds. Closing first drops the pending retry.
export function reconnect(): void {
  socket.disconnect();
  socket.connect();
}

// Sends a message and waits for the server's answer. Offline or unanswered messages fail at once
// rather than wait in a queue, with `server_busy` rather than `offline` while a busy server turns
// the page away.
export async function send<Data extends object = object>(event: string, payload: object = {}): Promise<Ack<Data>> {
  if (!socket.connected) return { ok: false, error: connection.busy ? 'server_busy' : 'offline' };
  try {
    return (await socket.timeout(5000).emitWithAck(event, payload)) as Ack<Data>;
  } catch {
    return { ok: false, error: 'timeout' };
  }
}

// Sends a message and shows the reason if the server refuses it. For the actions of a page, whose
// outcome arrives as a new snapshot of the room.
export async function act<Data extends object = object>(event: string, payload: object = {}): Promise<Ack<Data>> {
  const reply = await send<Data>(event, payload);
  if (!reply.ok) toastError(reply.error);
  return reply;
}

let checking = false;

async function checkConnection(): Promise<void> {
  if (!connection.everConnected) return;
  if (!socket.connected) {
    reconnect();
    return;
  }
  if (checking) return;
  checking = true;
  try {
    await socket.timeout(3000).emitWithAck('sys:ping', {});
  } catch {
    reconnect();
  } finally {
    checking = false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void checkConnection();
});
window.addEventListener('pageshow', () => void checkConnection());
window.addEventListener('online', () => void checkConnection());

// After a deploy, a page that is still open runs the old code. When the server's version differs
// from the page's, reload once, with the version in the address so that no cache can serve the
// old page again and the reload can't repeat itself.
function reloadIfOutdated(version: string): void {
  if (version === __APP_VERSION__ || version === 'dev' || __APP_VERSION__ === 'dev') return;
  const url = new URL(window.location.href);
  if (url.searchParams.get('v') === version) return;
  url.searchParams.set('v', version);
  window.location.replace(url.toString());
}
