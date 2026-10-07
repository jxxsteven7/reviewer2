import type { Ack, ClosedReason, Language, RoomView } from '@reviewer2/shared';
import { reactive, shallowRef } from 'vue';
import { connect, send, setHandshake, socket } from './socket';

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

// The room the page wants to be in, or null when it has left it. Its ID is known once the server
// has sent the room, and goes with every request to be let back in, so that a code that has since
// gone to another room doesn't take the page there (docs/architecture.md).
let wanted: { code: string; screen: boolean; roomId?: string } | null = null;

socket.on('room:state', (view: RoomView) => {
  if (!wanted) return; // the page has left this room
  const current = room.value;
  if (current && current.roomId === view.roomId && view.rev < current.rev) return;
  room.value = view;
  entry.status = 'in';
  wanted.roomId = view.roomId;
  setHandshake(view.me === null ? { watch: view.code, roomId: view.roomId } : { code: view.code, roomId: view.roomId });
});

socket.on('room:closed', ({ reason }: { reason: ClosedReason }) => {
  if (!wanted) return;
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

async function ask(name?: string): Promise<Ack> {
  if (!wanted) return { ok: false, error: 'unknown' };
  const { code, screen, roomId } = wanted;
  if (entry.status !== 'in') entry.status = 'joining';
  const reply = await send(screen ? 'room:watch' : 'room:join', {
    code,
    ...(roomId === undefined ? {} : { roomId }),
    ...(screen || name === undefined ? {} : { name }),
  });
  if (!wanted) return reply;
  if (reply.ok) {
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
    case 'timeout':
      break; // the next connection asks again
    default:
      // A newcomer whose name was refused stays on the name form, which shows the reason.
      if (name === undefined) Object.assign(entry, { status: 'failed', error: reply.error });
  }
  return reply;
}

// Opens a room by its code, as a player or as a screen.
export function openRoom(code: string, { screen = false } = {}): void {
  wanted = { code, screen };
  room.value = null;
  Object.assign(entry, { status: 'connecting', language: null, closed: null, error: null });
  setHandshake(screen ? { watch: code } : { code });
  if (socket.connected) void ask();
  else connect();
}

// A newcomer's name.
export const submitName = (name: string): Promise<Ack> => ask(name);

// The page goes elsewhere. The player keeps their seat until the room drops them.
export function closeRoomPage(): void {
  wanted = null;
  room.value = null;
  setHandshake({});
  Object.assign(entry, { status: 'idle', language: null, closed: null, error: null });
}

export async function leaveRoom(): Promise<Ack> {
  const reply = await send('room:leave');
  if (reply.ok) closeRoomPage();
  return reply;
}
