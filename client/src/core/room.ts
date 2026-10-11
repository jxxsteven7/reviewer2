import { parseCode, type Ack, type ClosedReason, type Language, type RoomView } from '@reviewer2/shared';
import { reactive, shallowRef } from 'vue';
import { connect, reconnect, send, setHandshake, socket } from './socket';

// The room this page shows, as the server last described it, and how far the page has got in
// entering it (docs/architecture.md).

export type EntryStatus = 'idle' | 'connecting' | 'joining' | 'needs_name' | 'in' | 'not_found' | 'closed' | 'failed';

export const room = shallowRef<RoomView | null>(null);

export const entry = reactive<{
  status: EntryStatus;
  // The room's language, known before joining from the server's name_required answer.
  language: Language | null;
  closed: ClosedReason | null;
  error: string | null;
}>({ status: 'idle', language: null, closed: null, error: null });

// The address that brings someone into a room.
export const roomLink = (code: string): string => `${window.location.origin}/room/${code}`;

// The room the page wants to be in, or null when it has left it. Its ID is known once the server
// has sent the room, and goes with every request to be let back in, so that a code that has since
// gone to another room doesn't take the page there (docs/architecture.md). Opening a room makes a
// new object, so that an answer or a snapshot can be told to belong to the room that is wanted now.
interface Wanted {
  code: string;
  screen: boolean;
  roomId?: string;
}

let wanted: Wanted | null = null;

// The newest snapshot that this connection has been sent, whichever page is showing. The server
// keeps a connection in its room when the page goes elsewhere, and goes on sending it snapshots.
// It sends nothing when the connection asks to join a room that it is in already, as the page does
// when it comes back to the room, or opens the room it has just created. The page starts from this
// snapshot then. A new connection is in no room until the server has said so with a snapshot.
let latest: RoomView | null = null;

socket.on('disconnect', () => (latest = null));

// Whether a snapshot shows the room the page wants, the way the page wants to see it: as a player
// or as a screen. The room's ID settles it once it is known; until then its code does.
function isWanted(view: RoomView): boolean {
  if (!wanted || (view.me === null) !== wanted.screen) return false;
  return wanted.roomId === undefined ? view.code === parseCode(wanted.code) : view.roomId === wanted.roomId;
}

function show(view: RoomView): void {
  room.value = view;
  entry.status = 'in';
  if (wanted) wanted.roomId = view.roomId;
  setHandshake(view.me === null ? { watch: view.code, roomId: view.roomId } : { code: view.code, roomId: view.roomId });
}

// Snapshots of a room that the page has left still arrive while the connection is in it. They are
// kept, in case the page comes back, but not shown.
socket.on('room:state', (view: RoomView) => {
  if (!latest || latest.roomId !== view.roomId || view.rev >= latest.rev) latest = view;
  if (!isWanted(view)) return;
  const current = room.value;
  if (current && current.roomId === view.roomId && view.rev < current.rev) return;
  show(view);
});

// The server closes the room that the connection is in, without naming it: that is the room of
// the newest snapshot, or the handshake's room when no snapshot has come since connecting. Only a
// closing of the room the page wants concerns the page.
socket.on('room:closed', ({ reason }: { reason: ClosedReason }) => {
  const closed = latest;
  latest = null;
  if (!wanted || (closed && !isWanted(closed))) return;
  wanted = null;
  room.value = null;
  setHandshake({});
  Object.assign(entry, { status: 'closed', closed: reason });
});

// After every reconnect, ask to enter again. The handshake has usually put the player back
// already, and asking again does no harm; it also notices a seat that was lost while offline.
socket.on('connect', () => {
  if (wanted && entry.status !== 'needs_name') void ask();
});

// A newcomer's name, and whether they have come to play or only to watch. A newcomer who is logged
// in gives no name: theirs is the username.
interface Newcomer {
  name?: string | undefined;
  play: boolean;
}

async function ask(newcomer?: Newcomer): Promise<Ack> {
  const asked = wanted;
  if (!asked) return { ok: false, error: 'unknown' };
  const { code, screen, roomId } = asked;
  // A newcomer stays on the name form while their name is on its way; the form says so itself.
  if (entry.status !== 'in' && !newcomer) entry.status = 'joining';
  const reply = await send<{ code: string; roomId: string }>(screen ? 'room:watch' : 'room:join', {
    code,
    ...(roomId === undefined ? {} : { roomId }),
    ...(screen || !newcomer ? {} : newcomer),
  });
  if (wanted !== asked) return reply; // the page has left this room, or wants another one now
  if (reply.ok) {
    asked.roomId = reply.roomId;
    if (!room.value) entry.status = 'joining';
    return reply;
  }
  switch (reply.error) {
    case 'name_required':
      Object.assign(entry, { status: 'needs_name', language: reply.language ?? null });
      break;
    case 'room_not_found':
      wanted = null;
      setHandshake({});
      entry.status = 'not_found';
      break;
    case 'offline':
      break; // the next connection asks again
    case 'timeout':
      // The server didn't answer in time. A fresh connection asks again, as after a ping that goes
      // unanswered. A newcomer's name goes back to the form, which asks them to try again.
      if (!newcomer) reconnect();
      break;
    default:
      // A newcomer whose name was refused stays on the name form, which shows the reason; one
      // whom the room, public by now, sends to log in leaves it for the notice, which has the
      // way to the account page and back.
      if (!newcomer || reply.error === 'account_required') {
        Object.assign(entry, { status: 'failed', error: reply.error });
      }
  }
  return reply;
}

// Opens a room by its code, as a player or as a screen.
export function openRoom(code: string, { screen = false } = {}): void {
  wanted = { code, screen };
  room.value = null;
  Object.assign(entry, { status: 'connecting', language: null, closed: null, error: null });
  setHandshake(screen ? { watch: code } : { code });
  // This connection may be in the room already, as a player or as a screen, whichever the page is.
  if (latest && isWanted(latest)) show(latest);
  if (socket.connected) void ask();
  else connect();
}

// A newcomer's name, and whether they have come to play or only to watch.
export const submitName = (name: string | undefined, play: boolean): Promise<Ack> =>
  ask(name === undefined ? { play } : { name, play });

// The page goes elsewhere. The player keeps their seat until the room drops them.
export function closeRoomPage(): void {
  wanted = null;
  room.value = null;
  setHandshake({});
  Object.assign(entry, { status: 'idle', language: null, closed: null, error: null });
}

// The player leaves the room, or the chair closes it for everyone. The server tells the player's
// other connections, and everyone else when the room closes, but not the connection that asked:
// it knows.
async function goAway(message: 'room:leave' | 'room:close'): Promise<Ack> {
  const reply = await send(message);
  if (reply.ok) {
    latest = null;
    closeRoomPage();
  }
  return reply;
}

export const leaveRoom = (): Promise<Ack> => goAway('room:leave');
export const closeRoom = (): Promise<Ack> => goAway('room:close');
