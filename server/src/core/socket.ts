import { ROOM_MESSAGES, type ClosedReason, type Handshake, type RoomMessage } from '@reviewer2/shared';
import type { Server, Socket } from 'socket.io';
import type { z } from 'zod';
import { clientIp } from './clientIp';
import type { GameModule } from './game';
import { cleanName, isToken, memberKey, newToken } from './identity';
import { randomId, type Rng } from './random';
import { TokenBucket, WindowCounter } from './rateLimit';
import type { Member, Room } from './room';
import type { Rooms } from './rooms';
import { drawWords, type WordLibrary } from './words';

// Socket.IO for rooms (docs/architecture.md): the handshake, every room message, and sending
// each connection its own snapshot. Game messages, named "<game>:<action>", go to the room's game
// module. Every handler runs from start to finish without awaiting anything, so two messages can
// never interleave.

export interface SocketOptions {
  rooms: Rooms;
  words: WordLibrary;
  games: ReadonlyMap<string, GameModule>;
  rng: Rng;
  now: () => number;
  version: string;
  trustProxy: boolean;
  log: (event: string, fields?: Record<string, unknown>) => void;
}

interface Connection {
  key: string;
  ip: string;
  issued: string | null; // a token that this connection still has to be told about
  room: Room | null;
  screen: boolean;
  bucket: TokenBucket;
}

type Reply = { ok: true; [field: string]: unknown } | { ok: false; error: string; [field: string]: unknown };
const ok = (fields: Record<string, unknown> = {}): Reply => ({ ok: true, ...fields });
const fail = (error: string): Reply => ({ ok: false, error });

const OWN_PREFIXES = new Set(['sys', 'meta', 'room']);

// Per connection: about 10 messages a second, in bursts of up to 20. Per address and minute: 5
// new rooms and 20 failed attempts to join one, which is enough to stop anyone from trying codes.
const MESSAGES_PER_SECOND = 10;
const MESSAGE_BURST = 20;
const CREATIONS_PER_MINUTE = 5;
const FAILED_JOINS_PER_MINUTE = 20;

export interface RoomSockets {
  broadcast(room: Room): void;
  sweep(): void;
  closeAll(reason: ClosedReason): void;
}

export function attachSockets(io: Server, options: SocketOptions): RoomSockets {
  const { rooms, words, games, rng, now, version, log } = options;
  const creations = new WindowCounter(CREATIONS_PER_MINUTE, 60_000, now);
  const failedJoins = new WindowCounter(FAILED_JOINS_PER_MINUTE, 60_000, now);
  const connection = (socket: Socket) => socket.data as Connection;
  const isOpen = (room: Room) => rooms.find(room.code) === room;

  function broadcast(room: Room): void {
    for (const member of room.members.values()) {
      if (member.sockets.size === 0) continue;
      const view = room.view({ playerId: member.id });
      for (const id of member.sockets) io.to(id).emit('room:state', view);
    }
    if (room.screens.size > 0) {
      const view = room.view({ screen: true });
      for (const id of room.screens) io.to(id).emit('room:state', view);
    }
  }

  // Tells connections that their room is gone for them.
  function closeFor(socketIds: Iterable<string>, reason: ClosedReason, except?: string): void {
    for (const id of socketIds) {
      const socket = io.sockets.sockets.get(id);
      if (!socket) continue;
      Object.assign(connection(socket), { room: null, screen: false });
      if (id !== except) socket.emit('room:closed', { reason });
    }
  }

  // Takes a connection out of the room it is in, if any.
  function release(socket: Socket): void {
    const conn = connection(socket);
    const { room } = conn;
    if (!room) return;
    room.detach(socket.id);
    Object.assign(conn, { room: null, screen: false });
    if (isOpen(room)) broadcast(room);
  }

  // Puts a connection into a room as a member, out of any room it was in before.
  function enter(socket: Socket, room: Room, member: Member): void {
    const conn = connection(socket);
    if (conn.room !== room || conn.screen) release(socket);
    Object.assign(conn, { room, screen: false });
    room.attach(member, socket.id);
    broadcast(room);
  }

  // Makes a connection a screen that shows a room without playing in it.
  function watch(socket: Socket, room: Room): Reply {
    const conn = connection(socket);
    if (conn.room !== room || !conn.screen) {
      if (room.screensFull()) return fail('screens_full');
      release(socket);
      room.addScreen(socket.id);
      Object.assign(conn, { room, screen: true });
    }
    socket.emit('room:state', room.view({ screen: true }));
    return ok({ code: room.code, roomId: room.id });
  }

  function membership(socket: Socket): { room: Room; member: Member } | null {
    const { room, screen } = connection(socket);
    const member = room && !screen ? room.memberBySocket(socket.id) : undefined;
    return room && member ? { room, member } : null;
  }

  // Runs a message's handler and answers it. The handler sends any new snapshots before the
  // answer goes out, so a client always has the state that its answer refers to.
  function respond(socket: Socket, ack: unknown, run: () => Reply): void {
    const reply = typeof ack === 'function' ? (ack as (reply: Reply) => void) : () => {};
    if (!connection(socket).bucket.take()) {
      reply(fail('rate_limited'));
      return;
    }
    try {
      reply(run());
    } catch (error) {
      log('error', { message: (error as Error).message, stack: (error as Error).stack });
      reply(fail('internal'));
    }
  }

  function on<M extends RoomMessage>(
    socket: Socket,
    message: M,
    handler: (payload: z.infer<(typeof ROOM_MESSAGES)[M]>) => Reply,
  ): void {
    const event: string = message;
    socket.on(event, (...args: unknown[]) => {
      const [body, answer] = typeof args[0] === 'function' ? [undefined, args[0]] : [args[0], args[1]];
      respond(socket, answer, () => {
        const parsed = ROOM_MESSAGES[message].safeParse(body ?? {});
        return parsed.success ? handler(parsed.data as z.infer<(typeof ROOM_MESSAGES)[M]>) : fail('bad_request');
      });
    });
  }

  // A chair's message: only the chair of the socket's room may send it.
  function asChair(socket: Socket, run: (room: Room, member: Member) => Reply): Reply {
    const found = membership(socket);
    if (!found) return fail('not_member');
    if (found.room.chairId !== found.member.id) return fail('not_chair');
    return run(found.room, found.member);
  }

  function changed(room: Room, result: { ok: true } | { ok: false; error: string }): Reply {
    if (!result.ok) return fail(result.error);
    broadcast(room);
    return ok();
  }

  io.use((socket, next) => {
    const auth = (socket.handshake.auth ?? {}) as Handshake;
    const token = isToken(auth.token) ? auth.token : null;
    const issued = token === null ? newToken() : null;
    const conn: Connection = {
      key: memberKey(token ?? (issued as string)),
      ip: clientIp(socket.handshake.address, socket.handshake.headers, options.trustProxy),
      issued,
      room: null,
      screen: false,
      bucket: new TokenBucket(MESSAGES_PER_SECOND, MESSAGE_BURST, now),
    };
    socket.data = conn;
    next();
  });

  io.on('connection', (socket) => {
    const conn = connection(socket);
    socket.emit('session', conn.issued ? { token: conn.issued, version } : { version });
    conn.issued = null;

    // A connection that comes back to its room is put back before any of its messages run, so a
    // message that waited out the disconnect doesn't arrive in a room that has forgotten it.
    const auth = (socket.handshake.auth ?? {}) as Handshake;
    if (typeof auth.watch === 'string') {
      const room = rooms.find(auth.watch);
      if (room) watch(socket, room);
      else socket.emit('room:closed', { reason: 'expired' });
    } else if (typeof auth.code === 'string') {
      // A different room ID means the code now belongs to a new room, not the one this
      // connection was in.
      const room = rooms.find(auth.code);
      if (!room || (auth.roomId !== undefined && room.id !== auth.roomId)) {
        socket.emit('room:closed', { reason: 'expired' });
      } else {
        const member = room.memberByKey(conn.key);
        if (member) enter(socket, room, member);
      }
    }

    on(socket, 'sys:ping', () => ok());

    on(socket, 'meta:fields', () => ok({ fields: words.fields() }));

    on(socket, 'room:create', ({ game, language, fields, name }) => {
      if (!creations.allowed(conn.ip)) return fail('rate_limited');
      const module = games.get(game);
      if (!module) return fail('bad_game');
      const chosen = [...new Set(fields)];
      if (!chosen.every((id) => words.has(id))) return fail('bad_fields');
      if (words.pool(chosen, language).length < module.wordsNeeded) return fail('no_words');
      if (cleanName(name) === null) return fail('name_invalid');
      const room = rooms.create({ game: module, language, fields: chosen });
      if (!room) return fail('too_many_rooms');
      creations.add(conn.ip);
      const joined = room.join(conn.key, name);
      if (!joined.ok) {
        rooms.close(room);
        return fail(joined.error);
      }
      log('room_created', { code: room.code, game, language, fields: chosen });
      enter(socket, room, joined.member);
      return ok({ code: room.code, roomId: room.id });
    });

    on(socket, 'room:join', ({ code, name }) => {
      if (!failedJoins.allowed(conn.ip)) return fail('rate_limited');
      const room = rooms.find(code);
      if (!room) {
        failedJoins.add(conn.ip);
        return fail('room_not_found');
      }
      const member = room.memberByKey(conn.key);
      if (member) {
        enter(socket, room, member);
        return ok({ code: room.code, roomId: room.id });
      }
      if (name === undefined) return { ok: false, error: 'name_required', language: room.language };
      const joined = room.join(conn.key, name);
      if (!joined.ok) return fail(joined.error);
      enter(socket, room, joined.member);
      return ok({ code: room.code, roomId: room.id });
    });

    on(socket, 'room:watch', ({ code }) => {
      const room = rooms.find(code);
      return room ? watch(socket, room) : fail('room_not_found');
    });

    on(socket, 'room:leave', () => {
      const found = membership(socket);
      if (!found) return fail('not_member');
      const { room, member } = found;
      closeFor(room.drop(member.id), 'left', socket.id);
      if (room.members.size === 0) closeFor(rooms.close(room), 'expired');
      else broadcast(room);
      return ok();
    });

    on(socket, 'room:rename', ({ name }) => {
      const found = membership(socket);
      if (!found) return fail('not_member');
      return changed(found.room, found.room.rename(found.member.id, name));
    });

    on(socket, 'room:settings', ({ fields }) =>
      asChair(socket, (room) => {
        const chosen = [...new Set(fields)];
        if (!chosen.every((id) => words.has(id))) return fail('bad_fields');
        if (words.pool(chosen, room.language).length < room.game.wordsNeeded) return fail('no_words');
        return changed(room, room.setFields(chosen));
      }),
    );

    on(socket, 'room:start', () =>
      asChair(socket, (room) => {
        if (room.phase !== 'lobby') return fail('wrong_phase');
        if (room.startProblems().length > 0) return fail('cannot_start');
        const pool = words.pool(room.fields, room.language);
        const draw = drawWords(pool, room.game.wordsNeeded, room.usedWords, rng);
        if (!draw) return fail('no_words');
        const result = room.start(draw.words, randomId());
        if (result.ok) {
          room.usedWords = draw.used;
          log('game_started', { code: room.code, players: room.members.size });
        }
        return changed(room, result);
      }),
    );

    on(socket, 'room:end', () => asChair(socket, (room) => changed(room, room.withdraw())));
    on(socket, 'room:again', () => asChair(socket, (room) => changed(room, room.again())));
    on(socket, 'room:shuffle', () => asChair(socket, (room) => changed(room, room.shuffle())));
    on(socket, 'room:spectate', ({ playerId }) => asChair(socket, (room) => changed(room, room.bench(playerId))));
    on(socket, 'room:chair', ({ playerId }) => asChair(socket, (room) => changed(room, room.handOver(playerId))));

    on(socket, 'room:remove', ({ playerId }) =>
      asChair(socket, (room, chair) => {
        if (playerId === chair.id) return fail('bad_request'); // the chair leaves instead
        const removed = room.remove(playerId);
        if (!removed.ok) return fail(removed.error);
        closeFor(removed.sockets, 'removed');
        broadcast(room);
        return ok();
      }),
    );

    // Everything else is a game message.
    socket.onAny((event: string, ...args: unknown[]) => {
      const prefix = event.split(':', 1)[0] ?? '';
      if (OWN_PREFIXES.has(prefix)) return;
      const ack = args.at(-1);
      const payload = typeof args[0] === 'function' ? undefined : args[0];
      respond(socket, ack, () => {
        const found = membership(socket);
        if (!found) return fail('not_member');
        if (prefix !== found.room.game.id) return fail('bad_request');
        const before = found.room.phase;
        const result = found.room.act(found.member.id, event, payload);
        if (result.ok && before === 'playing' && found.room.phase === 'ended') {
          log('game_ended', { code: found.room.code });
        }
        return changed(found.room, result);
      });
    });

    socket.on('disconnect', () => {
      const { room } = conn;
      if (!room) return;
      room.detach(socket.id);
      if (isOpen(room)) broadcast(room);
    });
  });

  return {
    broadcast,
    sweep() {
      const result = rooms.sweep();
      for (const { room, sockets } of result.closed) {
        closeFor(sockets, 'expired');
        log('room_closed', { code: room.code });
      }
      closeFor(result.dropped, 'expired');
      for (const room of result.changed) broadcast(room);
      creations.prune();
      failedJoins.prune();
    },
    closeAll(reason) {
      for (const room of rooms.all()) closeFor(rooms.close(room), reason);
    },
  };
}
