import { cleanName, type Ack, type ClosedReason, type EmoteEvent, type Session } from '@reviewer2/shared';
import { HANDSHAKE, ROOM_MESSAGES, type RoomMessage } from '@reviewer2/shared/schemas';
import type { Server, Socket } from 'socket.io';
import type { z } from 'zod';
import { fail } from './answers';
import { clientCountry, clientIp } from './clientIp';
import type { GameModule, Viewer } from './game';
import { isToken, memberKey, newToken } from './identity';
import { TokenBucket, WindowCounter } from './rateLimit';
import type { Member, Room } from './room';
import type { Rooms } from './rooms';
import type { WordLibrary } from './words';

// Socket.IO for rooms (docs/architecture.md): the handshake, every room message, and sending
// each connection its own snapshot. Game messages, named "<game>:<action>", go to the room's game
// module. Every handler runs from start to finish without awaiting anything, so two messages can
// never interleave.

// Starts and stops the timers for the games' deadlines. The server uses setTimeout; the tests
// put in timers that run on their own clock.
export interface Timers {
  // Runs `run` once, `ms` milliseconds from now, and returns what stops it.
  start(run: () => void, ms: number): unknown;
  stop(timer: unknown): void;
}

export const realTimers: Timers = {
  // A timer that is all that is left doesn't keep the process alive.
  start: (run, ms) => setTimeout(run, ms).unref(),
  stop: (timer) => clearTimeout(timer as NodeJS.Timeout),
};

export interface SocketOptions {
  rooms: Rooms;
  words: WordLibrary;
  games: ReadonlyMap<string, GameModule>;
  now: () => number;
  timers: Timers;
  version: string;
  trustProxy: boolean;
  roomsPerMinute: number;
  log: (event: string, fields?: Record<string, unknown>) => void;
}

interface Connection {
  key: string;
  ip: string;
  // For the status page only.
  country: string;
  room: Room | null;
  screen: boolean;
  bucket: TokenBucket;
}

// What the status page is told about one connection (stats.ts): how it is carried, the country it
// comes from, and in how many milliseconds its last heartbeat came back, if one has.
export interface ConnectionInfo {
  transport: string;
  country: string;
  latency: number | null;
}

// What a message is answered with (docs/architecture.md).
type Reply = Ack<Record<string, unknown>>;
const ok = (fields: Record<string, unknown> = {}): Reply => ({ ok: true, ...fields });

// "<prefix>:<action>". Game messages carry their game's ID as the prefix, so a game can't be named
// after one of the prefixes of the room messages.
const prefixOf = (event: string): string => event.split(':', 1)[0] ?? '';
const OWN_PREFIXES = new Set(Object.keys(ROOM_MESSAGES).map(prefixOf));

// Per connection: about 10 messages a second, in bursts of up to 20. Per address and minute: as
// many rooms as the options say (config.ts has the default), counting the attempts that came to
// nothing, and 20 codes that belong to no room, which keeps anyone from trying codes until one
// fits.
const MESSAGES_PER_SECOND = 10;
const MESSAGE_BURST = 20;
const FAILED_LOOKUPS_PER_MINUTE = 20;

export interface RoomSockets {
  broadcast(room: Room): void;
  sweep(): void;
  closeAll(reason: ClosedReason): void;
  connections(): ConnectionInfo[];
}

export function attachSockets(io: Server, options: SocketOptions): RoomSockets {
  const { rooms, words, games, now, timers, version, log } = options;
  for (const id of games.keys()) {
    if (OWN_PREFIXES.has(id)) throw new Error(`a game can't be named "${id}", which is a prefix of the room messages`);
  }
  const creations = new WindowCounter(options.roomsPerMinute, 60_000, now);
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

  // Sends some connections the room as one viewer sees it: every tab of a member, or every
  // screen. They get the same snapshot, so it is built once and goes out in one emit, which
  // Socket.IO encodes once for all of them. A view that the game can't build is that viewer's
  // loss alone: everyone else still gets theirs.
  function send(room: Room, socketIds: Iterable<string>, viewer: Viewer, view = room.views()): void {
    const ids = [...socketIds];
    if (ids.length === 0) return;
    try {
      io.to(ids).emit('room:state', view(viewer));
    } catch (error) {
      report(error, 'view', { code: room.code });
    }
  }

  // The last game of each room whose end has been logged.
  const endLogged = new WeakMap<Room, string>();
  // The rev that each room's last snapshots carried.
  const sent = new WeakMap<Room, number>();

  // Sends everyone in a room its new state. Every change to a room ends here, so this is also
  // where the end of a game is logged, however it came about: by one of the game's messages, by
  // the chair's withdrawal, or because someone left. And it is where the timer for the game's next
  // deadline is set, since only a change can move it.
  function broadcast(room: Room): void {
    if (room.phase === 'ended' && room.gameId !== null && endLogged.get(room) !== room.gameId) {
      endLogged.set(room, room.gameId);
      log('game_ended', { code: room.code });
    }
    sent.set(room, room.rev);
    const view = room.views();
    for (const member of room.members.values()) send(room, member.sockets, { playerId: member.id }, view);
    send(room, room.screens, { screen: true }, view);
    safely('deadline', () => schedule(room));
  }

  // The timer of each room whose game has a deadline, with the deadline it is for.
  const deadlines = new Map<Room, { at: number; timer: unknown }>();

  // Sets the timer for the room's next deadline, if it has one and it isn't set already. When a
  // game ends, is withdrawn or goes back to the waiting room, its deadline goes, and so does the
  // timer.
  function schedule(room: Room): void {
    const at = isOpen(room) ? room.deadline() : null;
    const set = deadlines.get(room);
    if (set?.at === at) return;
    unschedule(room);
    if (at === null) return;
    deadlines.set(room, { at, timer: timers.start(() => fire(room), Math.max(0, at - now())) });
  }

  function unschedule(room: Room): void {
    const set = deadlines.get(room);
    if (set) timers.stop(set.timer);
    deadlines.delete(room);
  }

  // The deadline has come. A timer may fire a moment early, by the room's clock, and then the game
  // has nothing due yet: the timer is set again.
  function fire(room: Room): void {
    deadlines.delete(room);
    safely('deadline', () => {
      if (!isOpen(room)) return;
      if (room.expire()) broadcast(room);
      else schedule(room);
    });
  }

  // Closes a room, tells whoever is still connected to it, apart from `except`, and logs it.
  // `why` is for the log: "empty", "idle", "stale", "chair" or "restart".
  function shut(room: Room, reason: ClosedReason, why: string, except?: string): void {
    closeFor(rooms.close(room), reason, except);
    unschedule(room);
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
    try {
      reply(answer);
    } catch (error) {
      // Socket.IO couldn't encode the answer. The message has been handled, so say that something
      // went wrong, which is better than saying nothing.
      report(error, 'answer');
      reply(fail('internal'));
    }
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
      // One request may carry several packets, and one of them may end the connection. Socket.IO
      // still hands the rest to this listener, though not to those registered with socket.on().
      // A message that came in after its connection ended must not put that connection into a
      // room: nothing would ever take it out again.
      if (!socket.connected) return;
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

  // The answer to a message that was to change a room, after telling everyone when it did. A
  // message that was granted but changed nothing, such as asking for the seat one is in, bumps
  // no rev, and then nobody is sent a snapshot that would only repeat the last one. A refused game
  // message may still find the room changed: the turn whose time had run out, which it was
  // meant for, ended just before it.
  function changed(room: Room, result: Ack): Reply {
    if (room.rev !== sent.get(room)) broadcast(room);
    return result.ok ? ok() : result;
  }

  // Times Engine.IO's heartbeat, which costs nothing extra: the server pings every connection every
  // 10 seconds, and the client answers at once, so the time to the answer is the round trip. The
  // heartbeat belongs to the Engine.IO connection underneath, and so does the timing: a client
  // can leave Socket.IO and come back on the same connection as often as it likes, and listeners
  // added for each of its sockets would pile up on the connection for as long as it lasts. The
  // clock starts when the ping is flushed to the wire, not when it is made: on long polling, a
  // ping made between two polls waits in the buffer for the next one.
  const latencies = new WeakMap<Socket['conn'], number>();

  function measureLatency(raw: Socket['conn']): void {
    let pingedAt: number | null = null;
    raw.on('flush', (packets: { type: string }[]) => {
      if (packets.some((packet) => packet.type === 'ping')) pingedAt = now();
    });
    raw.on('packet', (packet: { type: string }) => {
      if (packet.type !== 'pong' || pingedAt === null) return;
      latencies.set(raw, Math.round(now() - pingedAt));
      pingedAt = null;
    });
  }

  io.engine.on('connection', measureLatency);

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
      country: clientCountry(socket.handshake.headers, options.trustProxy),
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

    on(handlers, 'room:create', ({ game, language, fields, settings, name, play }) => {
      if (!creations.allowed(conn.ip)) return fail('rate_limited');
      const module = games.get(game);
      if (!module) return fail('bad_game');
      if (cleanName(name) === null) return fail('name_invalid');
      // From here on the attempt counts against the address, whatever comes of it. Checking the
      // fields goes through all of their words, which costs more than anything else a message
      // can ask for. The chair's messages that do the same need a room first; this one is open
      // to anyone, and must not be free to whoever asks for rooms that can't be.
      creations.add(conn.ip);
      const created = rooms.create({ game: module, language, fields, settings, key: conn.key, name, play });
      if (!created.ok) return created;
      const { room, member } = created;
      log('room_created', { code: room.code, game, language, fields: room.fields });
      enter(socket, room, member);
      return ok({ code: room.code, roomId: room.id });
    });

    on(handlers, 'room:join', ({ code, name, roomId, play }) => {
      const room = lookup(conn, code, roomId ?? undefined);
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
      const joined = room.join(conn.key, name, play);
      if (!joined.ok) return joined;
      enter(socket, room, joined.member);
      return ok({ code: room.code, roomId: room.id });
    });

    on(handlers, 'room:watch', ({ code, roomId }) => {
      const room = lookup(conn, code, roomId ?? undefined);
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

    // A quick reaction goes to every connection in the room, screens and the sender's own tabs
    // included. It is a moment rather than a change to the room: it bumps no rev and no snapshot
    // carries it, so whoever is offline misses it.
    on(handlers, 'room:emote', ({ emote }) => {
      const found = membership(socket);
      if (!found) return fail('not_member');
      const { room, member } = found;
      const result = room.emote(member.id);
      if (!result.ok) return result;
      const event: EmoteEvent = { roomId: room.id, playerId: member.id, emote };
      io.to(room.connections()).emit('room:emote', event);
      return ok();
    });

    on(handlers, 'room:settings', (changes) => asChair(socket, (room) => changed(room, room.setSettings(changes))));

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

    // The chair closes the room for everyone, screens included. The connection that asked is
    // answered rather than told, as when a player leaves: its page knows what it did. Members who
    // are offline find out when they come back, as from any room that closed while they were away.
    on(handlers, 'room:close', () =>
      asChair(socket, (room) => {
        shut(room, 'closed', 'chair', socket.id);
        return ok();
      }),
    );

    on(handlers, 'room:remove', ({ playerId }) =>
      asChair(socket, (room, chair) => {
        if (playerId === chair.id) return fail('bad_request'); // the chair leaves instead
        const removed = room.remove(playerId);
        if (!removed.ok) return removed;
        // A screen that the same browser had put up goes with the seat. Whoever was removed
        // can't put up a new one for now, and must not keep an old one either.
        const screens = [...room.screens].filter((id) => {
          const screen = io.sockets.sockets.get(id);
          return screen !== undefined && connection(screen).key === removed.key;
        });
        for (const id of screens) room.detach(id);
        closeFor([...removed.sockets, ...screens], 'removed');
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
          unschedule(room);
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
    connections() {
      return [...io.sockets.sockets.values()].map((socket) => ({
        transport: socket.conn.transport.name,
        country: connection(socket).country,
        latency: latencies.get(socket.conn) ?? null,
      }));
    },
  };
}
