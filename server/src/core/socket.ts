import { createHash } from 'node:crypto';
import {
  checkContact,
  checkCredit,
  checkFeedback,
  checkLink,
  checkReport,
  cleanName,
  isReservedName,
  type Ack,
  type ClosedReason,
  type EmoteEvent,
  type SeatedRoom,
  type Session,
} from '@reviewer2/shared';
import { HANDSHAKE, ROOM_MESSAGES, type RoomMessage } from '@reviewer2/shared/schemas';
import type { Server, Socket } from 'socket.io';
import type { z } from 'zod';
import { fromThisSite, readLoginCookie } from '../accounts/cookies';
import { avatarUrl, type Accounts } from '../accounts/service';
import type { FeedbackStore } from '../store/feedback';
import { fail, type Refusal } from './answers';
import { clientCountry, clientIp } from './clientIp';
import type { GameModule, Viewer } from './game';
import { accountKey, isToken, memberKey, newToken } from './identity';
import { TokenBucket, WindowCounter } from './rateLimit';
import type { Member, MemberAccount, Room } from './room';
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
  limits: SocketLimits;
  feedback: FeedbackStore;
  // Accounts, and whether their cookie is Secure. Without them, everyone is a guest.
  accounts?: Accounts;
  cookieSecure?: boolean;
  log: (event: string, fields?: Record<string, unknown>) => void;
}

// How much one connection, and one address, may ask of the server (docs/architecture.md).
export interface SocketLimits {
  // Per connection: about this many messages a second, in bursts of up to `messageBurst`.
  messagesPerSecond: number;
  messageBurst: number;
  // Per address and minute: attempts to create a room, counting those that came to nothing, and
  // codes that belong to no room, which keeps anyone from trying codes until one fits.
  roomsPerMinute: number;
  failedLookupsPerMinute: number;
  // Per address and hour: nicknames refused for being someone's username, which says that the
  // account exists, as registering the name would.
  reservedNamesPerHour: number;
  // Per address: how much feedback it may send in each window of `feedbackWindowMs`.
  feedbackPerWindow: number;
  feedbackWindowMs: number;
  // Per account and hour: reports of other players.
  reportsPerHour: number;
}

// The limits unless something says otherwise. ROOMS_PER_MINUTE can change `roomsPerMinute`
// (config.ts), and tests change the others, on copies: these are frozen.
export const DEFAULT_SOCKET_LIMITS: Readonly<SocketLimits> = Object.freeze({
  messagesPerSecond: 10,
  messageBurst: 20,
  roomsPerMinute: 5,
  failedLookupsPerMinute: 20,
  reservedNamesPerHour: 30,
  feedbackPerWindow: 3,
  feedbackWindowMs: 10 * 60_000,
  reportsPerHour: 5,
});

// The longest user agent that is kept with a bug report. Real ones are a few hundred characters.
const MAX_USER_AGENT = 512;
// The most rooms that meta:seats names. A player is in one room at a time, now and then two.
const MAX_SEATED = 5;

interface Connection {
  key: string;
  // The key that the browser has as a guest, from its token, which is the key above unless the
  // browser is logged in. A seat that the browser took as a guest is found by it (adoptGuest).
  guestKey: string;
  // The account that the connection is logged in to, with the hash of its login's secret, or null
  // for a guest. It is settled in the handshake, and the key comes from it then.
  account: { id: number; session: string } | null;
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

export interface RoomSockets {
  broadcast(room: Room): void;
  sweep(): void;
  closeAll(reason: ClosedReason): void;
  connections(): ConnectionInfo[];
}

const hex = (hash: Uint8Array): string => Buffer.from(hash).toString('hex');

export function attachSockets(io: Server, options: SocketOptions): RoomSockets {
  const { rooms, words, games, now, timers, version, limits, feedback, accounts, log } = options;
  for (const id of games.keys()) {
    if (OWN_PREFIXES.has(id)) throw new Error(`a game can't be named "${id}", which is a prefix of the room messages`);
  }
  const creations = new WindowCounter(limits.roomsPerMinute, 60_000, now);
  const failedLookups = new WindowCounter(limits.failedLookupsPerMinute, 60_000, now);
  const reservedNames = new WindowCounter(limits.reservedNamesPerHour, 60 * 60_000, now);
  const feedbackSent = new WindowCounter(limits.feedbackPerWindow, limits.feedbackWindowMs, now);
  const reportsSent = new WindowCounter(limits.reportsPerHour, 60 * 60_000, now);
  // The feedback that each address sent in the last window, as a hash of what was kept and when,
  // so that the same feedback sent again, as when the answer to the first was lost on the way
  // and the player pressed Send once more, is kept once (docs/architecture.md).
  const feedbackSeen = new Map<string, number>();
  const feedbackKey = (ip: string, kept: readonly unknown[]) =>
    `${ip}\n${createHash('sha256').update(JSON.stringify(kept)).digest('base64')}`;
  // Whether the log has been told that no more feedback is taken. Once is enough until feedback
  // is taken again, which takes a higher MAX_FEEDBACK (config.ts) and a restart, since nothing is
  // deleted to make room.
  let feedbackFullLogged = false;
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
      safely('records', () => keepRecords(room));
    }
    const { match } = room;
    if (match?.status === 'over' && matchLogged.get(room) !== match.id) {
      matchLogged.set(room, match.id);
      log('match_ended', { code: room.code, games: match.played });
      keepMatchRecords(room);
    }
    sent.set(room, room.rev);
    const view = room.views();
    for (const member of room.members.values()) send(room, member.sockets, { playerId: member.id }, view);
    send(room, room.screens.keys(), { screen: true }, view);
    safely('deadline', () => schedule(room));
  }

  // Keeps the game that has just ended on the record of every player with an account who took part
  // in it, as the game describes their part (GameModule.results()). Whoever had left by then has no
  // part in its end, and a game that the chair withdrew counts for nobody.
  function keepRecords(room: Room): void {
    const results = accounts && room.gameId !== null ? room.results() : null;
    if (!results || !accounts) return;
    for (const { playerId, ...result } of results) {
      const account = room.members.get(playerId)?.account;
      if (account) accounts.record(account.id, { game: room.game.id, gameId: room.gameId as string, ...result });
    }
  }

  // The last match of each room whose end has been logged and recorded.
  const matchLogged = new WeakMap<Room, string>();

  // Keeps a match that has run its course on the record of every ranked player with an account,
  // with the title that it awarded them, if any. A match that the chair ended early has no
  // ranking to keep. The database keeps a match once for each account, and a title once for each
  // match, however often this runs. What goes wrong for one account doesn't keep the match from
  // the others.
  function keepMatchRecords(room: Room): void {
    const { match } = room;
    if (!accounts || !match?.final || match.status !== 'over') return;
    const players = match.final.size;
    for (const [key, { rank, total, title }] of match.final) {
      const account = room.memberByKey(key)?.account;
      if (!account) continue;
      const record = { game: room.game.id, matchId: match.id, games: match.played, rank, players, score: total, title };
      safely('records', () => accounts.recordMatch(account.id, record));
    }
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
  function shut(room: Room, reason: ClosedReason, why: string, except?: Iterable<string>): void {
    closeFor(rooms.close(room), reason, except);
    unschedule(room);
    log('room_closed', { code: room.code, why });
  }

  // Takes connections out of their room and tells them why, apart from `except`, which have been
  // told already or asked for it themselves.
  function closeFor(socketIds: Iterable<string>, reason: ClosedReason, except: Iterable<string> = []): void {
    const quiet = new Set(except);
    for (const id of socketIds) {
      const socket = io.sockets.sockets.get(id);
      if (!socket) continue;
      Object.assign(connection(socket), { room: null, screen: false });
      if (!quiet.has(id)) socket.emit('room:closed', { reason });
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
    if (room.attach(member, socket.id, conn.guestKey)) broadcast(room);
    else send(room, [socket.id], { playerId: member.id });
  }

  // Makes a connection a screen that shows a room without playing in it. A screen shows what a
  // spectator sees. Whoever the chair removed can't put one up in place of the seat they lost, at
  // least not from the same browser. In a public room, whose code anyone can read off the list, a
  // screen is a member's: it takes an account that has a seat here, so that the chair can remove
  // whoever put it up, and their screens with them, and an account has one screen there, which a
  // new one replaces (Room.addScreen), so that nobody fills all five. The screens that were up
  // when the room was listed stay, as the guests who were there do. Such a screen is known by the
  // key it had then, which stays the browser's key as a guest after the browser has logged in.
  function watch(socket: Socket, room: Room): Reply {
    const conn = connection(socket);
    if (conn.room !== room || !conn.screen) {
      const kept = [conn.key, conn.guestKey].find((key) => room.screenKept(key));
      const refusal = kept ? removalOf(room, conn) : admission(room, conn);
      if (refusal) return refusal;
      if (room.public && !kept && !room.memberByKey(conn.key)) return fail('not_member');
      const key = kept ?? conn.key;
      if (room.screensFull(key)) return fail('screens_full');
      release(socket);
      closeFor(room.addScreen(socket.id, key), 'left');
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
  // - whoever is in it already, by their token or on this very connection, or by the guest seat
  //   that their account would adopt (meta:seats offers the way back to it);
  // - whoever gives its room ID. That takes having been sent it, and a wrong one finds nothing
  //   whatever the code, so such a lookup tells nobody anything about codes;
  // - whoever comes to a public room, whose code the list gives to anyone (meta:rooms).
  function lookup(conn: Connection, code: string, roomId?: string): Room | 'room_not_found' | 'rate_limited' {
    const room = rooms.find(code);
    if (roomId !== undefined) return room?.id === roomId ? room : 'room_not_found';
    if (room && (conn.room === room || room.memberByKey(conn.key) || guestSeat(room, conn) || room.public)) {
      return room;
    }
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
      const member = room.memberByKey(conn.key) ?? adoptGuest(room, conn);
      if (member) {
        enter(socket, room, member);
        if (room.rev !== sent.get(room)) broadcast(room);
      }
    } else if (auth.roomId !== undefined) {
      watch(socket, room);
    }
  }

  // The seat that a browser took as a guest becomes its account's, when the browser has logged in
  // or registered since: the player comes back to their seat, team and role, rather than find the
  // room's name theirs and the seat taken by themselves. The name becomes the username, unless
  // someone else in the room has it. Only a guest's seat is adopted, and only while the account has
  // no seat of its own here. Returns the member, or undefined when there was nothing to adopt.
  function adoptGuest(room: Room, conn: Connection): Member | undefined {
    const guest = guestSeat(room, conn);
    const account = guest && conn.account ? accounts?.store.byId(conn.account.id) : undefined;
    if (!guest || !account) return undefined;
    room.adopt(guest.id, conn.key, account.username, { id: account.id, avatar: avatarUrl(account) });
    return guest;
  }

  // The seat that the browser of a logged-in connection took as a guest, if its account may have
  // it (adoptGuest).
  function guestSeat(room: Room, conn: Connection): Member | undefined {
    if (!accounts || !conn.account || conn.guestKey === conn.key) return undefined;
    const guest = room.memberByKey(conn.guestKey);
    // An account the chair removed, or one that may not be in a public room, gets no seat this
    // way either; room:join tells it why.
    return guest && !guest.account && !admission(room, conn) ? guest : undefined;
  }

  // Why a connection may not come into a room anew, as a member or as a screen, before anything
  // else is asked of it: the chair removed it, by either of its keys, or the room is public and
  // it has no account that may be in one. Null when it may. Every way in but a member's return
  // to their seat goes through here, so that the rule is the same for all of them.
  function admission(room: Room, conn: Connection): Refusal | null {
    return removalOf(room, conn) ?? (room.public ? publicRefusal(conn) : null);
  }

  // The chair's removal of whoever has either of the connection's keys, as a refusal.
  function removalOf(room: Room, conn: Connection): Refusal | null {
    const removal = room.removal(conn.key, conn.guestKey);
    return removal ? fail(removal) : null;
  }

  // Why a connection may not create or join a public room, make its room one, or put up a screen
  // in one: it has no account, or the operator has barred its account from public rooms. Null
  // when it may.
  function publicRefusal(conn: Connection): Refusal | null {
    const account = conn.account && accounts?.store.byId(conn.account.id);
    if (!account) return fail('account_required');
    return account.publicBarred ? fail('public_barred') : null;
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
    // A browser that is logged in is its account, on every device; the token waits for it to log
    // out. Only the site's own pages may use the login cookie: a page elsewhere that opens a
    // connection here, which the browser would send the cookie with, gets a guest.
    const login =
      accounts && fromThisSite(socket.handshake.headers)
        ? accounts.login(readLoginCookie(socket.handshake.headers, options.cookieSecure ?? true))
        : null;
    const guestKey = memberKey(issued ?? (auth.token as string));
    const conn: Connection = {
      key: login ? accountKey(login.account.id) : guestKey,
      guestKey,
      account: login && { id: login.account.id, session: hex(login.hash) },
      ip: clientIp(socket.handshake.address, socket.handshake.headers, options.trustProxy),
      country: clientCountry(socket.handshake.headers, options.trustProxy),
      room: null,
      screen: false,
      bucket: new TokenBucket(limits.messagesPerSecond, limits.messageBurst, now),
    };
    socket.data = conn;
    const account = login && { username: login.account.username, avatar: avatarUrl(login.account) };
    const session: Session = issued === null ? { version, account } : { token: issued, version, account };
    socket.emit('session', session);

    safely('handshake', () => comeBack(socket, auth));

    // The name that someone who comes into a room has there: their username, when they are logged
    // in, or else the nickname they gave, which may not be anyone's username, nor one of the names
    // that nobody may register. The account is read again each time, since it may have been renamed
    // since the connection was made.
    function newcomer(
      nickname: string,
    ): { ok: true; name: string; account: MemberAccount | null } | ReturnType<typeof fail> {
      if (conn.account) {
        const account = accounts?.store.byId(conn.account.id);
        if (!account) return fail('not_member');
        return { ok: true, name: account.username, account: { id: account.id, avatar: avatarUrl(account) } };
      }
      if (cleanName(nickname) === null) return fail('name_invalid');
      return nameFree(nickname) ?? { ok: true, name: nickname, account: null };
    }

    // Why a guest may not have a nickname, or null when they may. Hearing that a name is someone's
    // username says that the account exists, as registering the name would, so an address may hear
    // it only so often; past that, every nickname it gives is refused for the rest of the hour,
    // since being let in would say as much (docs/architecture.md). The reserved names are public,
    // and say nothing.
    function nameFree(nickname: string): ReturnType<typeof fail> | null {
      if (isReservedName(nickname)) return fail('name_reserved');
      if (!accounts) return null;
      if (!reservedNames.allowed(conn.ip)) return fail('rate_limited');
      if (!accounts.reserved(nickname)) return null;
      reservedNames.add(conn.ip);
      return fail('name_reserved');
    }

    const handlers: Handlers = new Map();
    on(handlers, 'sys:ping', () => ok());

    on(handlers, 'meta:fields', () => ok({ fields: words.fields() }));
    on(handlers, 'meta:rooms', () => ok({ rooms: rooms.listed() }));

    // The rooms where the connection still has a seat, the newest first, for the home page to
    // offer the way back (docs/architecture.md): by its key, which is its account's on every
    // device, or by the seat that its browser took as a guest before logging in. It says nothing
    // about anyone else, and looks up no code, so it doesn't count against the codes an address
    // may try.
    on(handlers, 'meta:seats', () => {
      const seated = rooms
        .all()
        .reverse()
        .filter((room) => room.memberByKey(conn.key) ?? guestSeat(room, conn))
        .slice(0, MAX_SEATED);
      const seats: SeatedRoom[] = seated.map((room) => ({
        code: room.code,
        game: room.game.id,
        playing: room.phase !== 'lobby',
      }));
      return ok({ seats });
    });

    // Feedback for the author, which the status page shows. What is kept is what the player wrote
    // and what the page sent along, and, with a bug, the browser's user agent; nothing that says
    // who they are, unless they left a name for the acknowledgments: then the account they are
    // logged in to, if any, is kept with it, so that the acknowledgment can be counted for it. The
    // log gets its number and kind, and never its text, contact, name or link. Only what was kept
    // counts against the address, so that a player who is told to shorten their text doesn't lose
    // a turn for it, and feedback that the address sent once already in the window is answered as
    // it was the first time, without being kept or counted again.
    on(handlers, 'meta:feedback', (message) => {
      const { kind, text, contact, credit, link, version: pageVersion, language, page } = message;
      const checked = checkFeedback(text);
      if (checked.problem) return fail(checked.problem);
      const given = checkContact(contact);
      if (given.problem) return fail(given.problem);
      const named = checkCredit(credit);
      if (named.problem) return fail(named.problem);
      const linked = checkLink(link, named.credit);
      if (linked.problem) return fail(linked.problem);
      // A page from before players were asked about a public issue sends no answer.
      const publicIssue = message.publicIssue ?? null;
      const key = feedbackKey(conn.ip, [kind, checked.text, given.contact, named.credit, linked.link, publicIssue]);
      if (feedbackSeen.has(key)) return ok();
      if (!feedbackSent.allowed(conn.ip)) return fail('feedback_limited');
      const full = feedback.full();
      if (full) {
        if (!feedbackFullLogged) log('feedback_full', { reason: full });
        feedbackFullLogged = true;
        return fail('feedback_full');
      }
      const userAgent = socket.handshake.headers['user-agent'];
      // An account that has been deleted since the handshake is nobody's.
      const account = named.credit !== null && conn.account ? accounts?.store.byId(conn.account.id) : undefined;
      const id = feedback.add({
        kind,
        text: checked.text,
        contact: given.contact,
        credit: named.credit,
        link: linked.link,
        accountId: account?.id ?? null,
        publicIssue,
        version: pageVersion,
        language,
        page,
        userAgent: kind === 'bug' && userAgent ? userAgent.slice(0, MAX_USER_AGENT) : null,
      });
      feedbackSent.add(conn.ip);
      feedbackSeen.set(key, now());
      feedbackFullLogged = false;
      log('feedback_received', { id, kind });
      return ok();
    });

    on(handlers, 'room:create', ({ game, language, fields, settings, name: nickname, play, match, public: listed }) => {
      if (!creations.allowed(conn.ip)) return fail('rate_limited');
      const module = games.get(game);
      if (!module) return fail('bad_game');
      const refusal = listed ? publicRefusal(conn) : null;
      if (refusal) return refusal;
      const as = newcomer(nickname ?? '');
      if (!as.ok) return as;
      const { name, account } = as;
      // From here on the attempt counts against the address, whatever comes of it. Checking the
      // fields goes through all of their words, which costs more than anything else a message
      // can ask for. The chair's messages that do the same need a room first; this one is open
      // to anyone, and must not be free to whoever asks for rooms that can't be.
      creations.add(conn.ip);
      const created = rooms.create({
        game: module,
        language,
        fields,
        settings,
        key: conn.key,
        name,
        play,
        account,
        ...(match ? { match } : {}),
        public: listed ?? false,
      });
      if (!created.ok) return created;
      const { room, member } = created;
      log('room_created', {
        code: room.code,
        game,
        language,
        fields: room.fields,
        match: match?.games ?? null,
        public: room.public,
      });
      enter(socket, room, member);
      return ok({ code: room.code, roomId: room.id });
    });

    on(handlers, 'room:join', ({ code, name, roomId, play }) => {
      const room = lookup(conn, code, roomId ?? undefined);
      if (typeof room === 'string') return fail(room);
      const member = room.memberByKey(conn.key) ?? adoptGuest(room, conn);
      if (member) {
        enter(socket, room, member);
        if (room.rev !== sent.get(room)) broadcast(room);
        return ok({ code: room.code, roomId: room.id });
      }
      // Whatever keeps a newcomer out comes before the question for a name: nobody should fill
      // in the form only to hear that they were removed, that a public room takes only players
      // with accounts, or that the room is full.
      const refusal = admission(room, conn) ?? (room.full() ? fail('room_full') : null);
      if (refusal) return refusal;
      // A newcomer says who they are and whether they have come to play: a guest with a name and a
      // choice, and a player with an account, whose name is the username, with the choice alone.
      if (name === undefined && (!conn.account || play === undefined)) {
        return { ...fail('name_required'), language: room.language };
      }
      const as = newcomer(name ?? '');
      if (!as.ok) return as;
      const joined = room.join(conn.key, as.name, play, as.account);
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
      closeFor(room.drop(member.id), 'left', [socket.id]);
      if (room.members.size === 0) shut(room, 'expired', 'empty');
      else broadcast(room);
      return ok();
    });

    on(handlers, 'room:rename', ({ name }) => {
      const found = membership(socket);
      if (!found) return fail('not_member');
      if (!found.member.account && cleanName(name) !== null) {
        const refusal = nameFree(name);
        if (refusal) return refusal;
      }
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

    // Listing the room takes an account that may be in public rooms; taking it off the list
    // takes none, so that a chair whose account was barred meanwhile can still do that.
    on(handlers, 'room:public', ({ public: listed }) =>
      asChair(socket, (room) => {
        const refusal = listed ? publicRefusal(conn) : null;
        return refusal ?? changed(room, room.setPublic(listed));
      }),
    );

    // A member with an account reports another member of a public room to the operator
    // (docs/architecture.md#public-rooms). The report says who reported whom, in which room, and
    // what they wrote; the same pair is kept once per room, and answered as the first time was
    // whenever it is sent again, before the limit is looked at, as when the answer to the first
    // was lost on the way. An account may send only so many an hour. Whether the database could
    // take it is the sender's to hear, as with feedback, and only a report that was kept counts,
    // so that one the database couldn't take can be sent again.
    on(handlers, 'room:report', ({ playerId, text }) => {
      const found = membership(socket);
      if (!found) return fail('not_member');
      const { room, member } = found;
      if (!room.public || !accounts) return fail('not_public');
      if (!member.account) return fail('account_required');
      const reported = room.members.get(playerId);
      if (!reported) return fail('no_such_player');
      if (reported.id === member.id) return fail('bad_request');
      const note = checkReport(text);
      if (note.problem) return fail(note.problem);
      if (room.reported(member.key, reported.key)) return ok();
      const key = String(member.account.id);
      if (!reportsSent.allowed(key)) return fail('report_limited');
      const id = feedback.report({
        reporterId: member.account.id,
        reportedId: reported.account?.id ?? null,
        reportedName: reported.name,
        roomCode: room.code,
        text: note.text,
      });
      if (id === null) return fail('report_full');
      room.report(member.key, reported.key);
      reportsSent.add(key);
      log('report_received', { id, code: room.code });
      return ok();
    });

    on(handlers, 'room:start', ({ round }) =>
      asChair(socket, (room) => {
        const result = room.start(round);
        if (result.ok) log('game_started', { code: room.code, players: room.members.size });
        // Only a draw that found no way to keep the words apart has clashes (Room.start).
        if (result.ok && result.clashes > 0) {
          log('words_clashed', {
            code: room.code,
            language: room.language,
            fields: room.fields,
            clashes: result.clashes,
          });
        }
        return changed(room, result);
      }),
    );

    on(handlers, 'room:end', ({ gameId }) => asChair(socket, (room) => changed(room, room.withdraw(gameId))));
    on(handlers, 'room:again', ({ gameId }) => asChair(socket, (room) => changed(room, room.again(gameId))));
    on(handlers, 'room:matchEnd', ({ matchId }) => asChair(socket, (room) => changed(room, room.endMatch(matchId))));
    on(handlers, 'room:matchNext', ({ matchId, match }) =>
      asChair(socket, (room) => changed(room, room.nextMatch(matchId, match))),
    );
    on(handlers, 'room:shuffle', () => asChair(socket, (room) => changed(room, room.shuffle())));
    on(handlers, 'room:spectate', ({ playerId }) => asChair(socket, (room) => changed(room, room.bench(playerId))));
    on(handlers, 'room:chair', ({ playerId }) => asChair(socket, (room) => changed(room, room.handOver(playerId))));

    // Screens have no token and no name, so the chair can't pick one out: all of them go, and
    // those that belong there come back by themselves.
    on(handlers, 'room:dismiss', () =>
      asChair(socket, (room) => {
        closeFor(room.dismissScreens(), 'dismissed');
        broadcast(room);
        return ok();
      }),
    );

    // The chair closes the room for everyone, screens included. The connection that asked is
    // answered rather than told, as when a player leaves: its page knows what it did. The chair's
    // other tabs hear that the chair acted in another tab, as after room:leave, rather than that
    // the chair closed the room on them. Members who are offline find out when they come back, as
    // from any room that closed while they were away.
    on(handlers, 'room:close', () =>
      asChair(socket, (room, chair) => {
        const own = [...chair.sockets];
        closeFor(own, 'left', [socket.id]);
        shut(room, 'closed', 'chair', own);
        return ok();
      }),
    );

    on(handlers, 'room:remove', ({ playerId }) =>
      asChair(socket, (room, chair) => {
        if (playerId === chair.id) return fail('bad_request'); // the chair leaves instead
        const removed = room.remove(playerId);
        if (!removed.ok) return removed;
        // The screens put up by any key the player stays out by go with the seat, such as one that
        // their browser put up as a guest before logging in. Whoever was removed can't put up a new
        // one for now, and must not keep an old one either.
        const screens = removed.keys.flatMap((key) => room.screensOf(key));
        for (const id of screens) room.detach(id);
        closeFor([...removed.sockets, ...screens], removed.reason);
        broadcast(room);
        return ok();
      }),
    );

    listen(socket, handlers);

    socket.on('disconnect', () => safely('disconnect', () => release(socket)));
  });

  // What the account API can't do itself, since only the socket layer knows the connections.
  if (accounts) {
    // Connections that came with a login that has ended are the account no longer. Each is
    // told, and closed: whatever its page makes of that, it comes back through a new handshake,
    // as whoever its browser is now. Only closing the connection takes the seat back from a page
    // that took no notice, as one in the hands of whoever stole the login would.
    const connectionsOf = (test: (account: NonNullable<Connection['account']>) => boolean) =>
      [...io.sockets.sockets.values()].filter((socket) => {
        const { account } = connection(socket);
        return account !== null && test(account);
      });
    accounts.hooks = {
      sessionsEnded(hashes) {
        const ended = new Set(hashes.map(hex));
        for (const socket of connectionsOf(({ session }) => ended.has(session))) {
          socket.emit('account:ended');
          socket.disconnect(true);
        }
      },
      accountChanged(accountId) {
        const account = accounts.store.byId(accountId);
        if (!account) return;
        const key = accountKey(accountId);
        const avatar = avatarUrl(account);
        for (const room of rooms.all()) {
          const member = room.memberByKey(key);
          if (member && room.updateAccount(member.id, account.username, avatar)) broadcast(room);
        }
        // The account's own pages show the new name and avatar too.
        const session: Session = { version, account: { username: account.username, avatar } };
        for (const socket of connectionsOf(({ id }) => id === accountId)) socket.emit('session', session);
      },
      // An account that is gone leaves every room it was in, as if it had left. Leaving asks the
      // game module, and what one room's module throws must not keep the account in the others.
      accountDeleted(accountId) {
        const key = accountKey(accountId);
        for (const room of rooms.all()) {
          const member = room.memberByKey(key);
          if (!member) continue;
          safely('account_deleted', () => {
            closeFor(room.drop(member.id), 'left');
            if (room.members.size === 0) shut(room, 'expired', 'empty');
            else broadcast(room);
          });
        }
      },
    };
  }

  // What was changed on an account from outside the server, such as an avatar that the operator
  // took down (admin.ts), reaches the rooms by the next sweep: every member with an account is read
  // again, and a room that looks different for it is sent to everyone in it. A public room whose
  // chair could no longer put it on the list goes off it: the operator has barred the chair's
  // account meanwhile, or the chair has passed to a guest who was there before the room was listed.
  // Whoever is in it stays, as when the chair takes it off. A deleted account can only have left
  // through the hook above, so one that is gone is left alone here.
  function refreshAccounts(): void {
    if (!accounts) return;
    const read = new Map<number, ReturnType<typeof accounts.store.byId>>();
    for (const room of rooms.all()) {
      let differs = false;
      for (const member of room.members.values()) {
        if (!member.account) continue;
        const { id } = member.account;
        if (!read.has(id)) read.set(id, accounts.store.byId(id));
        const account = read.get(id);
        if (account && room.updateAccount(member.id, account.username, avatarUrl(account))) differs = true;
      }
      const chair = room.chairId === null ? undefined : room.members.get(room.chairId);
      const account = chair?.account ? read.get(chair.account.id) : undefined;
      if (room.public && chair && (!account || account.publicBarred) && room.unlist()) {
        log('room_unlisted', { code: room.code });
        differs = true;
      }
      if (differs) broadcast(room);
    }
  }

  return {
    broadcast,
    sweep() {
      safely('accounts', refreshAccounts);
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
        feedbackSent.prune();
        reportsSent.prune();
        for (const [key, time] of feedbackSeen) {
          if (now() - time >= limits.feedbackWindowMs) feedbackSeen.delete(key);
        }
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
