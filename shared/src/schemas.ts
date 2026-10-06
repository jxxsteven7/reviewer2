import { z } from 'zod';
import { LANGUAGES } from './language';

// The schemas that the server checks every message against (docs/architecture.md). Only the
// server imports this module, so that the client's bundle doesn't need zod: a schema is built
// when its module loads, so no bundler can leave it out, and building one probes `new Function`,
// which the page's own Content Security Policy refuses.

// A code as someone typed it, with whatever they put around and between its characters.
const code = z.string().max(32);
const name = z.string().max(64);
const playerId = z.string().max(32);
const gameId = z.string().max(64);
const roomId = z.string().max(64);
const fields = z.array(z.string().max(64)).min(1).max(20);
const none = z.object({});

export const ROOM_MESSAGES = {
  'sys:ping': none,
  'meta:fields': none,
  'room:create': z.object({ game: z.string().max(32), language: z.enum(LANGUAGES), fields, name }),
  // Whoever has been in the room names its ID as well, so that a code that has since gone to
  // another room doesn't take them there.
  'room:join': z.object({ code, name: name.optional(), roomId: roomId.optional() }),
  'room:watch': z.object({ code, roomId: roomId.optional() }),
  'room:leave': none,
  'room:rename': z.object({ name }),
  // The chair's controls.
  'room:settings': z.object({ fields }),
  // The chair's messages about a game say which game they mean, so that one that comes late or
  // twice can't land in another: a start gives how many games the room has started so far, and a
  // withdrawal and "play again" give the game's ID.
  'room:start': z.object({ round: z.number().int().min(0) }),
  'room:end': z.object({ gameId }),
  'room:again': z.object({ gameId }),
  'room:shuffle': none,
  'room:spectate': z.object({ playerId }),
  'room:remove': z.object({ playerId }),
  'room:chair': z.object({ playerId }),
} as const;

export type RoomMessage = keyof typeof ROOM_MESSAGES;

// The handshake (`Handshake` in protocol.ts). A field that isn't what it should be counts as
// missing, rather than spoil the others or the connection.
const lenient = <Field extends z.ZodType>(field: Field) => field.optional().catch(undefined);

export const HANDSHAKE = z
  .object({ token: lenient(z.string().max(64)), code: lenient(code), roomId: lenient(roomId), watch: lenient(code) })
  .catch({});
