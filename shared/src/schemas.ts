import { z } from 'zod';
import { LANGUAGES } from './language';

// The schemas that the server checks every message against (docs/architecture.md). Only the
// server imports this module, so that the client's bundle doesn't need zod: a schema is built
// when its module loads, so no bundler can leave it out, and building one probes `new Function`,
// which the page's own Content Security Policy refuses.

const code = z.string().max(16);
const name = z.string().max(64);
const playerId = z.string().max(32);
const gameId = z.string().max(64);
const fields = z.array(z.string().max(64)).min(1).max(20);
const none = z.object({});

export const ROOM_MESSAGES = {
  'sys:ping': none,
  'meta:fields': none,
  'room:create': z.object({ game: z.string().max(32), language: z.enum(LANGUAGES), fields, name }),
  'room:join': z.object({ code, name: name.optional() }),
  'room:watch': z.object({ code }),
  'room:leave': none,
  'room:rename': z.object({ name }),
  // The chair's controls.
  'room:settings': z.object({ fields }),
  'room:start': none,
  // A withdrawal names its game, so that one sent late can't end the next game.
  'room:end': z.object({ gameId }),
  'room:again': none,
  'room:shuffle': none,
  'room:spectate': z.object({ playerId }),
  'room:remove': z.object({ playerId }),
  'room:chair': z.object({ playerId }),
} as const;

export type RoomMessage = keyof typeof ROOM_MESSAGES;
