import { cleanName, type Ack, type ClosedReason, type Session } from '@reviewer2/shared';
import { HANDSHAKE, ROOM_MESSAGES, type RoomMessage } from '@reviewer2/shared/schemas';
import type { Server, Socket } from 'socket.io';
import type { z } from 'zod';
import { fail } from './answers';
import { clientIp } from './clientIp';
import { isToken, memberKey, newToken } from './identity';
import { TokenBucket, WindowCounter } from './rateLimit';
import type { GameModule, Viewer } from './game';
import type { Member, Room } from './room';
import type { Rooms } from './rooms';
import type { WordLibrary } from './words';

// Socket.IO for rooms (docs/architecture.md): the handshake, every room message, and sending
// each connection its own snapshot. Game messages, named "<game>:<action>", go to the room's game
// module. Every handler runs from start to finish without awaiting anything, so two messages can
// never interleave.

export interface SocketOptions {
  rooms: Rooms;
  words: WordLibrary;
  games: ReadonlyMap<string, GameModule>;
  now: () => number;
  version: string;
  trustProxy: boolean;
  log: (event: string, fields?: Record<string, unknown>) => void;
}

interface Connection {
  key: string;
  ip: string;
  room: Room | null;
  screen: boolean;
  bucket: TokenBucket;
}

// What a message is answered with (docs/architecture.md).
type Reply = Ack<Record<string, unknown>>;
const ok = (fields: Record<string, unknown> = {}): Reply => ({ ok: true, ...fields });

// "<prefix>:<action>". Game messages carry their game's ID as the prefix, so a game can't be named
// after one of the prefixes of the room messages.
const prefixOf = (event: string): string => event.split(':', 1)[0] ?? '';
const OWN_PREFIXES = new Set(Object.keys(ROOM_MESSAGES).map(prefixOf));

// Per connection: about 10 messages a second, in bursts of up to 20. Per address and minute: 5
// rooms, counting the attempts that came to nothing, and 20 codes that belong to no room, which
// keeps anyone from trying codes until one fits.
const MESSAGES_PER_SECOND = 10;
const MESSAGE_BURST = 20;
const CREATIONS_PER_MINUTE = 5;
const FAILED_LOOKUPS_PER_MINUTE = 20;

export interface RoomSockets {
  broadcast(room: Room): void;
  sweep(): void;
  closeAll(reason: ClosedReason): void;
}

export function attachSockets(io: Server, options: SocketOptions): RoomSockets {
  const { rooms, words, games, now, version, log } = options;
  for (const id of games.keys()) {
    if (OWN_PREFIXES.has(id)) throw new Error(`a game can't be named "${id}", which is a prefix of the room messages`);
  }
  const creations = new WindowCounter(CREATIONS_PER_MINUTE, 60_000, now);
  const failedLookups = new WindowCounter(FAILED_LOOKUPS_PER_MINUTE, 60_000, now);
  const connection = (socket: Socket) => socket.data as Connection;
  const isOpen = (room: Room) => rooms.find(room.code) === room;

  // Logs something that went wrong, whatever was thrown: a game module may throw anything.
  function report(error: unknown, where: string, fields: Record<string, unknown> = {}): void {
    let message = 'something that cannot be described';
    try {
      message = error instanceof Error ? error.message : String(error);
    } catch {
      // Keep the placeholder.
    }
    log('error', {
      where,
      message,
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      ...fields,
    });
  }

  // Runs what no message is waiting for: a handshake, a disconnect, the sweep. They call the
  // game modules too, and what a module throws there must not end the process.
  function safely(where: string, run: () => void): void {
    try {
      run();
    } catch (error) {
      report(error, where);
    }
  }

  // Sends some connections the room as one viewer sees it. A view that the game can't build is
  // that viewer's loss alone: everyone else still gets theirs.
  function send(room: Room, socketIds: Iterable<string>, viewer: Viewer): void {
    const ids = [...socketIds];
    if (ids.length === 0) return;
    try {
      const view = room.view(viewer);
      for (const id of ids) io.to(id).emit('room:state', view);
    } catch (error) {
      report(error, 'view', { code: room.code });
    }
  }

  // The last game of each room whose end has been logged.
  const endLogged = new WeakMap<Room, string>();

  // Sends everyone in a room its new state. Every change to a room ends here, so this is also
  // where the end of a game is logged, however it came about: by one of the game's messages, by
  // the chair's withdrawal, or because someone left.
  function broadcast(room: Room): void {
    if (room.phase === 'ended' && room.gameId !== null && endLogged.get(room) !== room.gameId) {
      endLogged.set(room, room.gameId);
      log('game_ended', { code: room.code });
    }
    for (const member of room.members.values()) send(room, member.sockets, { playerId: member.id });
    send(room, room.screens, { screen: true });
  }

  // Closes a room, tells whoever is still connected to it, and logs it. `why` is for the log:
  // "empty", "idle", "stale" or "restart".
  function shut(room: Room, reason: ClosedReason, why: string): void {
    closeFor(rooms.close(room), reason);
    log('room_closed', { code: room.code, why });
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
    Object.assign(conn, { room: null, screen: false });
    if (room.detach(socket.id) && isOpen(room)) broadcast(room);
  }

  // Puts a connection into a room as a member, out of any room it was in before. A snapshot goes
  // to everyone only when they can see a difference: the member has come online. A second tab of
  // someone who is online gets the state for itself, and a connection that is in the room already
  // and asks again, as a client does after every reconnect, gets nothing new.
  function enter(socket: Socket, room: Room, member: Member): void {
    const conn = connection(socket);
    if (conn.room === room && !conn.screen && member.sockets.has(socket.id)) return;
    release(socket);
    Object.assign(conn, { room, screen: false });
    if (room.attach(member, socket.id)) broadcast(room);
    else send(room, [socket.id], { playerId: member.id });
  }

  // Makes a connection a screen that shows a room without playing in it.
  function watch(socket: Socket, room: Room): Reply {
    const conn = connection(socket);
    if (conn.room !== room || !conn.screen) {
      // A screen shows what a spectator sees. Whoever the chair has just removed can't put one
      // up in place of the seat they lost, at least not from the same browser.
      if (room.removedRecently(conn.key)) return fail('removed_recently');
      if (room.screensFull()) return fail('screens_full');
      release(socket);
      room.addScreen(socket.id);
      Object.assign(conn, { room, screen: true });
      // Everyone sees how many screens there are, and this one gets its first view.
      broadcast(room);
    }
    return ok({ code: room.code, roomId: room.id });
  }

  // Finds the room that belongs to a code, for someone who wants in. Every way into a room comes
  // through here, so that none of them can be used to try codes until one fits. An address that
  // has sent too many codes without a room is refused for the rest of its minute, whether or not
  // this code is right: otherwise it could go on telling right from wrong.
  //
  // An address is rarely one person. A lab shares one, and so does everyone behind a reverse
  // proxy that isn't trusted. So the limit is only for those who could be trying codes, and
  // never for someone who has been in the room:
  //
  // - whoever is in it already, by their token or on this very connection;
  // - whoever gives its room ID. That takes having been sent it, and a wrong one finds nothing
  //   whatever the code, so such a lookup tells nobody anything about codes.
  function lookup(conn: Connection, code: string, roomId?: string): Room | 'room_not_found' | 'rate_limited' {
    const room = rooms.find(code);
    if (roomId !== undefined) return room?.id === roomId ? room : 'room_not_found';
    if (room && (conn.room === room || room.memberByKey(conn.key))) return room;
    if (!failedLookups.allowed(conn.ip)) return 'rate_limited';
    if (room) return room;
    failedLookups.add(conn.ip);
    return 'room_not_found';
  }

  // Brings a connection back to the room that its handshake names, before any of its messages
  // run, so that a message that waited out the disconnect doesn't arrive in a room that has
  // forgotten the player.
  //
  // The handshake only brings back: a member by their token, and a screen by the room ID it was
  // sent. Nobody gets in for the first time here, and a bare code gets no answer at all, neither
  // "you are in" nor "no such room", so a handshake can't be used to try codes either. A first
  // visit, and whatever else the handshake leaves open, goes through room:join or room:watch,
  // which are answered.
  function comeBack(socket: Socket, auth: z.infer<typeof HANDSHAKE>): void {
    const conn = connection(socket);
    const code = auth.watch ?? auth.code;
    if (code === undefined) return;
    const found = rooms.find(code);
    // A different room ID means the code now belongs to a new room, not the one this connection
    // was in.
    const room = found && (auth.roomId === undefined || found.id === auth.roomId) ? found : undefined;
    if (!room) {
      if (auth.roomId !== undefined) socket.emit('room:closed', { reason: 'expired' });
    } else if (auth.watch === undefined) {
      const member = room.memberByKey(conn.key);
      if (member) enter(socket, room, member);
    } else if (auth.roomId !== undefined) {
      watch(socket, room);
    }
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
    let answer: Reply;
    try {
      answer = run();
    } catch (error) {
      report(error, 'message');
      answer = fail('internal');
    }
    reply(answer);
  }

  // The handlers of one connection's room messages. They are looked up when a message arrives
  // (see `listen`) and not registered with socket.on(): Socket.IO runs such listeners a tick
  // later than the one that takes game messages, so a game message could overtake a room
  // message that the same connection had sent before it.
  type Handlers = Map<string, (body: unknown) => Reply>;

  function on<M extends RoomMessage>(
    handlers: Handlers,
    message: M,
    handler: (payload: z.infer<(typeof ROOM_MESSAGES)[M]>) => Reply,
  ): void {
    handlers.set(message, (body) => {
      const parsed = ROOM_MESSAGES[message].safeParse(body ?? {});
      return parsed.success ? handler(parsed.data as z.infer<(typeof ROOM_MESSAGES)[M]>) : fail('bad_request');
    });
  }

  // A game message, which goes to the game of the room that the connection is in.
  function play(socket: Socket, event: string, payload: unknown): Reply {
    const found = membership(socket);
    if (!found) return fail('not_member');
    if (prefixOf(event) !== found.room.game.id) return fail('bad_request');
    return changed(found.room, found.room.act(found.member.id, event, payload));
  }

  // Every message of a connection comes through here, one after the other and in the order in
  // which it arrived, and every one is answered. Socket.IO puts the acknowledgement last; before
  // it a message has its payload and nothing else.
  function listen(socket: Socket, handlers: Handlers): void {
    socket.onAny((event: unknown, ...args: unknown[]) => {
      const ack = typeof args.at(-1) === 'function' ? args.pop() : undefined;
      respond(socket, ack, () => {
        // Socket.IO also delivers events that are named by a number.
        if (typeof event !== 'string' || args.length > 1) return fail('bad_request');
        const handler = handlers.get(event);
        if (handler) return handler(args[0]);
        return OWN_PREFIXES.has(prefixOf(event)) ? fail('bad_request') : play(socket, event, args[0]);
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

  // The answer to a message that was to change a room, after telling everyone when it did.
  function changed(room: Room, result: Ack): Reply {
    if (!result.ok) return result;
    broadcast(room);
    return ok();
  }

  // Behind a reverse proxy every connection comes from the proxy's address, and then all players
  // share the limits of one address. A forwarded address that goes unread is the sign of it.
  let forwardedIgnored = false;

  io.on('connection', (socket) => {
    if (!options.trustProxy && !forwardedIgnored && socket.handshake.headers['x-forwarded-for'] !== undefined) {
      forwardedIgnored = true;
      log('forwarded_address_ignored', { hint: 'behind a reverse proxy, set TRUST_PROXY=1' });
    }
    const auth = HANDSHAKE.parse(socket.handshake.auth);
    // A browser that comes without a token, or with something that can't be one, is given one.
    const issued = isToken(auth.token) ? null : newToken();
    const conn: Connection = {
      key: memberKey(issued ?? (auth.token as string)),
      ip: clientIp(socket.handshake.address, socket.handshake.headers, options.trustProxy),
      room: null,
      screen: false,
      bucket: new TokenBucket(MESSAGES_PER_SECOND, MESSAGE_BURST, now),
    };
    socket.data = conn;
    const session: Session = issued === null ? { version } : { token: issued, version };
    socket.emit('session', session);

    safely('handshake', () => comeBack(socket, auth));

    const handlers: Handlers = new Map();
    on(handlers, 'sys:ping', () => ok());

    on(handlers, 'meta:fields', () => ok({ fields: words.fields() }));

    on(handlers, 'room:create', ({ game, language, fields, name }) => {
      if (!creations.allowed(conn.ip)) return fail('rate_limited');
      const module = games.get(game);
      if (!module) return fail('bad_game');
      if (cleanName(name) === null) return fail('name_invalid');
      // From here on the attempt counts against the address, whatever comes of it. Checking the
      // fields goes through all of their words, which is the one costly step of all the messages,
      // and it must not be free to anyone who asks for rooms that can't be.
      creations.add(conn.ip);
      const created = rooms.create({ game: module, language, fields });
      if (!created.ok) return created;
      const { room } = created;
      const joined = room.join(conn.key, name);
      // The name was checked above and the room is new, so nothing can refuse its first member.
      if (!joined.ok) throw new Error(`a new room refused its creator: ${joined.error}`);
      log('room_created', { code: room.code, game, language, fields: room.fields });
      enter(socket, room, joined.member);
      return ok({ code: room.code, roomId: room.id });
    });

    on(handlers, 'room:join', ({ code, name, roomId }) => {
      const room = lookup(conn, code, roomId);
      if (typeof room === 'string') return fail(room);
      const member = room.memberByKey(conn.key);
      if (member) {
        enter(socket, room, member);
        return ok({ code: room.code, roomId: room.id });
      }
      // Whatever keeps a newcomer out comes before the question for a name: nobody should fill
      // in the form only to hear that the room is full or that they were removed.
      const refusal = room.refusal(conn.key);
      if (refusal) return fail(refusal);
      if (name === undefined) return { ...fail('name_required'), language: room.language };
      const joined = room.join(conn.key, name);
      if (!joined.ok) return joined;
      enter(socket, room, joined.member);
      return ok({ code: room.code, roomId: room.id });
    });

    on(handlers, 'room:watch', ({ code, roomId }) => {
      const room = lookup(conn, code, roomId);
      return typeof room === 'string' ? fail(room) : watch(socket, room);
    });

    on(handlers, 'room:leave', () => {
      const found = membership(socket);
      if (!found) return fail('not_member');
      const { room, member } = found;
      closeFor(room.drop(member.id), 'left', socket.id);
      if (room.members.size === 0) shut(room, 'expired', 'empty');
      else broadcast(room);
      return ok();
    });

    on(handlers, 'room:rename', ({ name }) => {
      const found = membership(socket);
      if (!found) return fail('not_member');
      return changed(found.room, found.room.rename(found.member.id, name));
    });

    on(handlers, 'room:settings', ({ fields }) => asChair(socket, (room) => changed(room, room.setFields(fields))));

    on(handlers, 'room:start', ({ round }) =>
      asChair(socket, (room) => {
        const result = room.start(round);
        if (result.ok) log('game_started', { code: room.code, players: room.members.size });
        return changed(room, result);
      }),
    );

    on(handlers, 'room:end', ({ gameId }) => asChair(socket, (room) => changed(room, room.withdraw(gameId))));
    on(handlers, 'room:again', ({ gameId }) => asChair(socket, (room) => changed(room, room.again(gameId))));
    on(handlers, 'room:shuffle', () => asChair(socket, (room) => changed(room, room.shuffle())));
    on(handlers, 'room:spectate', ({ playerId }) => asChair(socket, (room) => changed(room, room.bench(playerId))));
    on(handlers, 'room:chair', ({ playerId }) => asChair(socket, (room) => changed(room, room.handOver(playerId))));

    // Screens have no token and no name, so the chair can't pick one out: all of them go, and
    // those that belong there come back by themselves.
    on(handlers, 'room:dismiss', () =>
      asChair(socket, (room) => {
        closeFor(room.dismissScreens(), 'removed');
        broadcast(room);
        return ok();
      }),
    );

    on(handlers, 'room:remove', ({ playerId }) =>
      asChair(socket, (room, chair) => {
        if (playerId === chair.id) return fail('bad_request'); // the chair leaves instead
        const removed = room.remove(playerId);
        if (!removed.ok) return removed;
        closeFor(removed.sockets, 'removed');
        broadcast(room);
        return ok();
      }),
    );

    listen(socket, handlers);

    socket.on('disconnect', () => safely('disconnect', () => release(socket)));
  });

  return {
    broadcast,
    sweep() {
      safely('sweep', () => {
        const result = rooms.sweep();
        for (const { room, error } of result.failed) report(error, 'sweep', { code: room.code });
        for (const { room, sockets, why } of result.closed) {
          closeFor(sockets, 'expired');
          log('room_closed', { code: room.code, why });
        }
        for (const room of result.changed) broadcast(room);
        creations.prune();
        failedLookups.prune();
      });
    },
    closeAll(reason) {
      for (const room of rooms.all()) shut(room, reason, reason);
    },
  };
}
