import { createHash } from 'node:crypto';
import {
  checkAlias,
  checkContact,
  checkCredit,
  checkFeedback,
  checkFriendNote,
  checkReport,
  INVITE_COOLDOWN_MS,
  JOIN_ASKS_PER_HOUR,
  type Ack,
  type ClosedReason,
  type DuoPart,
  type DuoView,
  type EmoteEvent,
  type FriendRequestView,
  type FriendRoomView,
  type FriendView,
  type InvitationView,
  type InvitedView,
  type JoinAskView,
  type Rank,
  type SeatedRoom,
  type Session,
} from '@reviewer2/shared';
import { HANDSHAKE, ROOM_MESSAGES, type RoomMessage } from '@reviewer2/shared/schemas';
import type { Server, Socket } from 'socket.io';
import type { z } from 'zod';
import { fromThisSite, readLoginCookie } from '../accounts/cookies';
import { avatarUrl, type Accounts } from '../accounts/service';
import type { Account } from '../store/accounts';
import type { FeedbackStore } from '../store/feedback';
import type { FriendRow } from '../store/friends';
import type { AgentChannel } from './agentChannel';
import { AgentDriver } from './agents';
import { fail, type Refusal } from './answers';
import { markDeleted } from './gameLog';
import { clientCountry, clientIp } from './clientIp';
import type { GameModule, Viewer } from './game';
import { accountKey, isToken, memberKey, newToken } from './identity';
import { Invitations, type Invitation } from './invitations';
import { JoinAsks, type JoinAsk } from './joinAsks';
import { TokenBucket, WindowCounter } from './rateLimit';
import type { Member, MemberAccount, Room } from './room';
import type { Rooms } from './rooms';
import type { WordLibrary } from './words';

// Socket.IO for rooms (docs/architecture.md): the handshake, every room message, and sending
// each connection its own snapshot. Game messages, named "<game>:<action>", go to the room's game
// module. Every handler runs from start to finish without awaiting anything, so two messages can
// never interleave.

// Starts and stops the timers for the games' deadlines and for the invitations that lapse
// (invitations.ts). The server uses setTimeout; the tests put in timers that run on their own
// clock.
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
  // The agent, which plays for the AI players, and whether it answers, which the rooms read too
  // (docs/architecture.md#ai-players). Without it, there are no AI players.
  agent?: { channel: AgentChannel; state: { up: boolean } };
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
  // For the status page: whether the agent answers, and the AI's steps of the last hour, or null on
  // a server without an agent.
  agents(): { up: boolean; steps: number; failures: number } | null;
}

const hex = (hash: Uint8Array): string => Buffer.from(hash).toString('hex');

export function attachSockets(io: Server, options: SocketOptions): RoomSockets {
  const { rooms, words, games, now, timers, version, limits, feedback, accounts, log } = options;
  for (const id of games.keys()) {
    if (OWN_PREFIXES.has(id)) throw new Error(`a game can't be named "${id}", which is a prefix of the room messages`);
  }
  const creations = new WindowCounter(limits.roomsPerMinute, 60_000, now);
  const failedLookups = new WindowCounter(limits.failedLookupsPerMinute, 60_000, now);
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
  // The AI players' driver (agents.ts), which sends their moves through the rooms as the socket
  // layer sends a player's, and the new state to everyone when a move changed anything.
  const driver =
    options.agent &&
    new AgentDriver({
      channel: options.agent.channel,
      state: options.agent.state,
      now,
      timers,
      log,
      broadcast: (room) => {
        if (isOpen(room) && room.rev !== sent.get(room)) broadcast(room);
      },
      isOpen,
      rooms: () => rooms.all(),
    });
  // The connections of each account that is logged in, so that whether a friend is online, and
  // where their invitations go, costs no walk through every connection.
  const accountSockets = new Map<number, Set<string>>();
  // Invitations to rooms, and how often a member may invite the same friend
  // (docs/architecture.md#friends). However an invitation ends, every connection of the invited
  // account hears so, and takes it off the page, and the inviter gets the room again without it;
  // one that lapses by its age ends on a timer, with no message waiting.
  const invitations = new Invitations(
    now,
    isOpen,
    (a, b) => accounts?.friends.areFriends(a, b) ?? false,
    ({ id, inviteeId, room, inviterKey }) =>
      safely('invitation', () => {
        tellAccount(inviteeId, 'friends:uninvited', { id });
        const inviter = room.memberByKey(inviterKey);
        if (inviter && isOpen(room)) send(room, inviter.sockets, { playerId: inviter.id });
      }),
    timers,
  );
  const invites = new WindowCounter(1, INVITE_COOLDOWN_MS, now);
  // Requests to be let into a friend's room, and how many an account sends an hour. However a
  // request ends, every connection of the friend asked hears so, and takes it off the page, and
  // the account that asked hears that its friends changed, and offers to ask again.
  const asks = new JoinAsks(
    now,
    isOpen,
    (a, b) => accounts?.friends.areFriends(a, b) ?? false,
    ({ id, fromId, toId }) => {
      tellAccount(toId, 'friends:unasked', { id });
      tellAccount(fromId, 'friends:changed');
    },
  );
  const asking = new WindowCounter(JOIN_ASKS_PER_HOUR, 60 * 60_000, now);

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
      const state = view(viewer);
      const invited = 'playerId' in viewer ? invitedBy(room, viewer.playerId) : [];
      io.to(ids).emit('room:state', invited.length > 0 ? { ...state, invited } : state);
    } catch (error) {
      report(error, 'view', { code: room.code });
    }
  }

  // The friends whom a member has invited into the room, while the invitations stand.
  function invitedBy(room: Room, playerId: string): InvitedView[] {
    const accountId = room.members.get(playerId)?.account?.id;
    if (accountId === undefined || !accounts) return [];
    return invitations.by(room, accountId).flatMap(({ inviteeId }) => {
      const friend = accounts.store.byId(inviteeId);
      return friend ? [{ username: friend.username, avatar: avatarUrl(friend) }] : [];
    });
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
    if (driver) safely('agents', () => driver.poke(room));
  }

  // What the end of a game leaves behind. A game that finished leaves its part in it on the record
  // of each player with an account, as the game describes it (GameModule.results()), with the
  // points it brought them (Room.points()), the match it was played in, if any (Room.matchGame()),
  // and the titles it brought them; the streak it brought them to, which the room tells in the
  // snapshot that ends the game (Room.noteStreak()); their ranks as they are now for everyone to
  // see; and the titles that the game brought friends who played in it, which the room tells each
  // account alone (Room.noteDuos()). A game that an AI played in brings nobody points, a streak or
  // a title (docs/architecture.md#ai-players). Whoever had left by then has no part in its end.
  //
  // Then every game, however it ended, finished, withdrawn or cut short, and whoever played in it,
  // leaves the record of the game itself (docs/architecture.md#game-records): how it ended and what
  // kind of game it was, how it began, the log of everything that happened with the AI's own log
  // beside it, and which player was which account, from which a game that finished is watched
  // again (docs/architecture.md#replays). A game with words of the chair's own leaves none
  // (Room.record()). Whatever else is to be kept of a game goes here, after the records.
  function keepRecords(room: Room): void {
    if (!accounts || room.gameId === null) return;
    const gameId = room.gameId;
    const results = room.ending === 'finished' ? room.results() : null;
    const points = room.points();
    const match = room.matchGame();
    // Those whose game went on the record, by account ID, with their player ID, side and result.
    const recorded = new Map<number, DuoPart & { playerId: string }>();
    for (const { playerId, ...result } of results ?? []) {
      const member = room.members.get(playerId);
      const account = member?.account && accounts.store.byId(member.account.id);
      if (!member || !account) continue;
      const record = {
        game: room.game.id,
        gameId,
        points: points?.get(member.key) ?? 0,
        match,
        agents: room.agentsPlayed,
        ...result,
      };
      const streak = accounts.record(account.id, record);
      if (streak) {
        room.noteStreak(member.id, streak);
        recorded.set(account.id, { playerId: member.id, side: result.side, won: result.won });
      }
      room.updateAccount(member.id, account.username, avatarUrl(account), accounts.rankOf(account.id), account.agents);
    }
    if (recorded.size > 1) safely('duos', () => noteDuos(room, recorded));
    const kept = room.record();
    if (!kept) return;
    const { players, forgotten } = stillThere(kept.accounts);
    const gameLog = kept.log && markDeleted(kept.log, forgotten);
    safely('replay', () => {
      const stored = accounts.keepGame({
        game: room.game.id,
        gameId,
        ending: kept.ending,
        outcome: kept.outcome,
        durationMs: kept.durationMs,
        setup: kept.setup,
        log: gameLog,
        agentLog: kept.agentLog,
        players,
        counts: kept.counts,
        takeover: kept.takeover,
        agentPlays: kept.agentPlays,
        match: kept.match,
        practice: kept.practice,
        language: kept.language,
        fields: kept.fields,
        version,
        rules: kept.rules,
        words: kept.words,
      });
      // A log that grew too long is worth a line only when the rest of the record was kept: what
      // kept the record out, such as a full database, has a line of its own.
      if (stored && kept.overflowed) log('game_log_too_large', { code: room.code });
    });
  }

  // Tells each account whose game went on the record of the titles that the game brought friends
  // who played in it (docs/architecture.md#friend-duos), by their player IDs in the room. Only the
  // account itself is told: who is friends with whom is nobody else's business.
  function noteDuos(room: Room, recorded: ReadonlyMap<number, DuoPart & { playerId: string }>): void {
    for (const [accountId, { playerId }] of recorded) {
      const brought = (accounts as Accounts).duosBrought(accountId, recorded);
      const notices = brought.flatMap(({ friend, title, count }) => {
        const theirs = recorded.get(friend);
        return theirs ? [{ playerId: theirs.playerId, title, count }] : [];
      });
      room.noteDuos(playerId, notices);
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
    cut(room, why);
    closeFor(rooms.close(room), reason, except);
    unschedule(room);
    driver?.forget(room);
    log('room_closed', { code: room.code, why });
  }

  // A room that closes with its game on cuts the game short there, which keeps its record
  // (Room.cut()); one that closes after its game ended keeps what the groups said since.
  function cut(room: Room, why: string): void {
    if (room.cut(why)) safely('records', () => keepRecords(room));
    else keepReview(room);
  }

  // Which of those who played in a game, by account, are still there, and the player IDs of those
  // whose account was deleted meanwhile: they no longer count as having played, and the log marks
  // them (markDeleted), as it would have if the account had been deleted after the game.
  function stillThere(played: readonly { playerId: string; accountId: number }[]): {
    players: { playerId: string; accountId: number }[];
    forgotten: Set<string>;
  } {
    const players = played.filter(({ accountId }) => accounts?.store.byId(accountId) !== undefined);
    const forgotten = new Set(played.filter((player) => !players.includes(player)).map(({ playerId }) => playerId));
    return { players, forgotten };
  }

  // What the groups said after the end of the game, as they talked it over, goes into the game's
  // record as the room leaves the game behind (Room.review()): when the chair plays again or starts
  // the next match, and when the room closes. The player IDs of an account deleted meanwhile are
  // marked, as in the rest of the log.
  function keepReview(room: Room): void {
    if (!accounts) return;
    safely('records', () => {
      const review = room.review();
      if (!review) return;
      const { players, forgotten } = stillThere(review.accounts);
      accounts.keepReview(review.gameId, review.entries, players, forgotten);
    });
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
    // An account that is in the room has no more use for its invitations there, nor to ask in.
    if (conn.account) {
      invitations.used(room, conn.account.id);
      asks.answered(room, conn.account.id);
    }
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
    room.adopt(guest.id, conn.key, account.username, memberAccount(account));
    return guest;
  }

  // What a room keeps of a member's account: which it is, its handle, its avatar and its rank.
  function memberAccount(account: Account): MemberAccount {
    return {
      id: account.id,
      handle: account.handle,
      avatar: avatarUrl(account),
      rank: (accounts as Accounts).rankOf(account.id),
      agents: account.agents,
    };
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

  // A game has started in a room: by the chair, or as a practice room was made. Only a draw that
  // found no way to keep the words apart has clashes (Room.start), which the log blames on the
  // fields that the game drew from, those drawn anew for it where the room draws them.
  function logStart(room: Room, clashes: number): void {
    log('game_started', { code: room.code, players: room.members.size });
    if (clashes > 0) {
      log('words_clashed', { code: room.code, language: room.language, fields: [...room.gameFields], clashes });
    }
  }

  // --- friends and invitations (docs/architecture.md#friends) -------------------------------

  // The account that a connection is logged in to, read again now, or why it has none.
  function accountOf(conn: Connection): { ok: true; account: Account } | Refusal {
    const account = conn.account && accounts?.store.byId(conn.account.id);
    return account ? { ok: true, account } : fail('account_required');
  }

  const isOnline = (accountId: number) => (accountSockets.get(accountId)?.size ?? 0) > 0;

  // The room that an account is in, if it is online in one: the room of one of its connections,
  // which stays in the room while the page is elsewhere, as the seat does.
  function roomOf(accountId: number): Room | undefined {
    for (const id of accountSockets.get(accountId) ?? []) {
      const socket = io.sockets.sockets.get(id);
      const conn = socket && connection(socket);
      if (conn?.room && !conn.screen && isOpen(conn.room)) return conn.room;
    }
    return undefined;
  }

  // A friend as the account page shows them to the account: online or not, and where, which only
  // friends learn (docs/architecture.md#friends), whether the account has asked them to be let into
  // their room, and what the two have played together (docs/architecture.md#friend-duos). A private
  // room is shown without its code, unless the account has a seat in it too.
  function friendView(
    viewerId: number,
    { id, handle, username, avatar, alias }: FriendRow,
    duo: DuoView | null,
  ): FriendView {
    const online = isOnline(id);
    const room = online ? roomOf(id) : undefined;
    const known = room && (room.public || room.memberByKey(accountKey(viewerId)) !== undefined);
    return {
      handle,
      username,
      ...(alias ? { alias } : {}),
      avatar: avatarUrl({ avatar }),
      online,
      room: room ? { code: known ? room.code : null } : null,
      ...(asks.between(viewerId, id) ? { asked: true as const } : {}),
      duo,
    };
  }

  const requestView = ({ handle, username, avatar, note }: FriendRow): FriendRequestView => ({
    handle,
    username,
    avatar: avatarUrl({ avatar }),
    ...(note ? { note } : {}),
  });

  // An invitation as the invited account hears it. The inviter is still in the room, or the
  // invitation would no longer stand, and comes with the name that the invitee gives them, if any,
  // which goes to the invitee alone.
  function invitationView(invitation: Invitation): InvitationView {
    const inviter = invitation.room.memberByKey(invitation.inviterKey);
    const alias = accounts?.friends.store.aliasOf(invitation.inviteeId, invitation.inviterId) ?? null;
    return {
      id: invitation.id,
      code: invitation.room.code,
      roomId: invitation.room.id,
      from: {
        username: inviter?.name ?? '',
        ...(alias === null ? {} : { alias }),
        avatar: inviter?.account?.avatar ?? null,
      },
      expiresInMs: invitations.remaining(invitation),
    };
  }

  // A request to be let into the room, as the friend asked hears it, with the name that they give
  // the account that asks, if any, which goes to them alone.
  function askView(ask: JoinAsk): JoinAskView {
    const from = accounts?.store.byId(ask.fromId);
    const alias = accounts?.friends.store.aliasOf(ask.toId, ask.fromId) ?? null;
    return {
      id: ask.id,
      roomId: ask.room.id,
      from: {
        username: from?.username ?? '',
        ...(alias === null ? {} : { alias }),
        avatar: from ? avatarUrl(from) : null,
      },
      expiresInMs: asks.remaining(ask),
    };
  }

  // Sends every connection of an account a message.
  function tellAccount(accountId: number, event: string, payload?: object): void {
    const sockets = accountSockets.get(accountId);
    if (sockets?.size) io.to([...sockets]).emit(event, ...(payload === undefined ? [] : [payload]));
  }

  // Tells every connection of these accounts that their friends or requests have changed, so that a
  // page that shows them asks again.
  function tellFriends(...accountIds: number[]): void {
    for (const id of accountIds) tellAccount(id, 'friends:changed');
  }

  // The room that an invitation lets a connection into: the invitation's, while it stands, or else
  // the room by the code, where the connection has a seat already, having come in before. Otherwise
  // why not: there is no such invitation for this account, or it has lapsed.
  function invited(
    conn: Connection,
    id: string,
    code: string | undefined,
    roomId: string | undefined,
  ): Room | 'invitation_expired' {
    const invitation = conn.account ? invitations.find(id, conn.account.id) : undefined;
    if (invitation) return invitation.room;
    const room = code === undefined ? undefined : rooms.find(code);
    if (!room || (roomId !== undefined && room.id !== roomId)) return 'invitation_expired';
    return (room.memberByKey(conn.key) ?? guestSeat(room, conn)) ? room : 'invitation_expired';
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

    // Who someone who comes into a room is there: the account they are logged in to, with its
    // username, or else a guest, whom the room gives a number. The account is read again each
    // time, since it may have been renamed since the connection was made.
    function newcomer():
      { ok: true; as: { username: string; account: MemberAccount } | null } | ReturnType<typeof fail> {
      if (!conn.account) return { ok: true, as: null };
      const account = accounts?.store.byId(conn.account.id);
      if (!account) return fail('not_member');
      return { ok: true, as: { username: account.username, account: memberAccount(account) } };
    }

    const handlers: Handlers = new Map();
    on(handlers, 'sys:ping', () => ok());

    on(handlers, 'meta:fields', () => ok({ fields: words.fields() }));
    on(handlers, 'meta:rooms', () => ok({ rooms: rooms.listed() }));
    // Whether the AI players answer now, for the home page to offer a practice room or say that
    // they are offline (docs/architecture.md#practice-rooms), or null on a server without an
    // agent, where the home page offers none. What the agent said last is the answer, and the
    // agent is asked again for the next one if that was a while ago.
    on(handlers, 'meta:agents', () => {
      if (!driver) return ok({ available: null });
      driver.recheck();
      return ok({ available: driver.state.up });
    });

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
    // who they are but the name they may leave for the feedback contributions and the account
    // they are logged in to, if any, with a name or without, so that the feedback counts for it
    // once it is adopted, and whether the name links to that account's public profile. A player
    // who is logged in and signs the feedback (`linkProfile`) is listed by the account, with its
    // username as the name, whatever name was sent along, as older pages may; anyone else may
    // leave a name of their own. Feedback to be signed with an account that the connection no
    // longer has, as when the login ended after the page was loaded, is refused with no name to
    // fall back on, rather than kept as anonymous. The log gets its number and kind, and never its
    // text, contact or name. Only what was kept counts against the address, so that a player who
    // is told to shorten their text doesn't lose a turn for it, and feedback that the address sent
    // once already in the window is answered as it was the first time, without being kept or
    // counted again.
    on(handlers, 'meta:feedback', (message) => {
      const { kind, text, contact, credit, linkProfile, version: pageVersion, language, page } = message;
      const checked = checkFeedback(text);
      if (checked.problem) return fail(checked.problem);
      const given = checkContact(contact);
      if (given.problem) return fail(given.problem);
      // An account that has been deleted since the handshake is nobody's.
      const account = conn.account ? accounts?.store.byId(conn.account.id) : undefined;
      const linked = linkProfile === true && account !== undefined;
      const named = linked ? { credit: account.username, problem: null } : checkCredit(credit);
      if (named.problem) return fail(named.problem);
      if (linkProfile === true && !linked && named.credit === null) return fail('feedback_unsigned');
      const key = feedbackKey(conn.ip, [kind, checked.text, given.contact, named.credit, linked]);
      if (feedbackSeen.has(key)) return ok();
      if (!feedbackSent.allowed(conn.ip)) return fail('feedback_limited');
      const full = feedback.full();
      if (full) {
        if (!feedbackFullLogged) log('feedback_full', { reason: full });
        feedbackFullLogged = true;
        return fail('feedback_full');
      }
      const userAgent = socket.handshake.headers['user-agent'];
      const id = feedback.add({
        kind,
        text: checked.text,
        contact: given.contact,
        credit: named.credit,
        accountId: account?.id ?? null,
        linkProfile: linked,
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

    // A practice room (docs/architecture.md#practice-rooms) is for an account, and is private, plays
    // no match and has the game's default settings. Its game starts as soon as its creator is in it,
    // online; should it not, they are in its waiting room with the AI players, as in any room.
    on(handlers, 'room:create', (message) => {
      const { game, language, fields, randomFields, settings, play, match, public: listed, practice } = message;
      if (!creations.allowed(conn.ip)) return fail('rate_limited');
      const module = games.get(game);
      if (!module) return fail('bad_game');
      if (practice && (match || listed || settings !== undefined || randomFields)) return fail('bad_request');
      const refusal = listed ? publicRefusal(conn) : null;
      if (refusal) return refusal;
      if (practice && !accountOf(conn).ok) return fail('account_required');
      const entering = newcomer();
      if (!entering.ok) return entering;
      const { as } = entering;
      const account = as?.account ?? null;
      // From here on the attempt counts against the address, whatever comes of it. Checking the
      // fields goes through all of their words, which costs more than anything else a message
      // can ask for. The chair's messages that do the same need a room first; this one is open
      // to anyone, and must not be free to whoever asks for rooms that can't be.
      creations.add(conn.ip);
      const created = rooms.create({
        game: module,
        language,
        fields,
        randomFields: randomFields ?? false,
        settings,
        key: conn.key,
        play,
        as,
        ...(match ? { match } : {}),
        public: listed ?? false,
        ...(practice ? { practice: practice.role } : {}),
      });
      if (!created.ok) return created;
      const { room, member } = created;
      log('room_created', {
        code: room.code,
        game,
        language,
        fields: room.fields,
        randomFields: room.randomFields,
        match: match?.games ?? null,
        public: room.public,
        practice: practice?.role ?? null,
      });
      enter(socket, room, member);
      // The account's next room setup starts from this one (RoomSetup in shared/src/accounts.ts),
      // with the game's settings as the game took them. The room is made whatever comes of
      // keeping it.
      if (account) {
        safely('room_setup', () =>
          accounts?.rememberRoomSetup(
            account.id,
            practice
              ? { practice: { role: practice.role, fields: room.fields } }
              : {
                  room: {
                    game,
                    language,
                    fields: room.fields,
                    randomFields: room.randomFields,
                    ...(settings === undefined ? {} : { settings: room.gameSettings ?? settings }),
                    match: match ?? null,
                    public: room.public,
                    play: play ?? false,
                  },
                },
          ),
        );
      }
      if (room.practice) {
        const started = room.start(room.round);
        if (started.ok) logStart(room, started.clashes);
        changed(room, started);
      }
      return ok({ code: room.code, roomId: room.id });
    });

    // A friend who was invited gives the invitation in place of the code (docs/architecture.md#friends);
    // from there on they are a newcomer like any other, whom a removal or the account requirement of
    // a public room keeps out as it would anyone. Whoever has a seat comes back by the code, whether
    // or not the invitation that brought them still stands.
    on(handlers, 'room:join', ({ code, roomId, play, invitation }) => {
      if (code === undefined && invitation === undefined) return fail('bad_request');
      const room =
        invitation === undefined
          ? lookup(conn, code as string, roomId ?? undefined)
          : invited(conn, invitation, code, roomId ?? undefined);
      if (typeof room === 'string') return fail(room);
      const member = room.memberByKey(conn.key) ?? adoptGuest(room, conn);
      if (member) {
        enter(socket, room, member);
        if (room.rev !== sent.get(room)) broadcast(room);
        return ok({ code: room.code, roomId: room.id });
      }
      // Whatever keeps a newcomer out comes before the question whether they play: nobody should
      // answer it only to hear that they were removed, that a public room takes only players with
      // accounts, or that the room is full.
      const refusal = admission(room, conn) ?? (room.full() ? fail('room_full') : null);
      if (refusal) return refusal;
      // A newcomer says whether they have come to play or only to watch.
      if (play === undefined) return { ...fail('play_required'), language: room.language };
      const entering = newcomer();
      if (!entering.ok) return entering;
      const joined = room.join(conn.key, play, entering.as);
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
        if (result.ok) logStart(room, result.clashes);
        return changed(room, result);
      }),
    );

    on(handlers, 'room:end', ({ gameId }) => asChair(socket, (room) => changed(room, room.withdraw(gameId))));
    on(handlers, 'room:again', ({ gameId }) =>
      asChair(socket, (room) => {
        keepReview(room);
        return changed(room, room.again(gameId));
      }),
    );
    on(handlers, 'room:matchEnd', ({ matchId }) => asChair(socket, (room) => changed(room, room.endMatch(matchId))));
    on(handlers, 'room:matchNext', ({ matchId, match }) =>
      asChair(socket, (room) => {
        keepReview(room);
        return changed(room, room.nextMatch(matchId, match));
      }),
    );
    on(handlers, 'room:shuffle', () => asChair(socket, (room) => changed(room, room.shuffle())));
    on(handlers, 'room:spectate', ({ playerId }) => asChair(socket, (room) => changed(room, room.bench(playerId))));
    // The chair invites an AI player (docs/architecture.md#ai-players). Only a chair whose account
    // the operator lets have them can, in a private room that plays no match (Room.agentsAllowed).
    on(handlers, 'room:addAgent', ({ persona, seat }) =>
      asChair(socket, (room) => {
        const added = room.addAgent(persona, seat);
        if (added.ok) log('agent_added', { code: room.code, persona });
        return changed(room, added);
      }),
    );
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

    // The account's friends and the requests between them and others. Only the account's own
    // connections ask, and only friends learn whether someone is online and where, and what the two
    // have played together.
    on(handlers, 'friends:list', () => {
      const me = accountOf(conn);
      if (!me.ok) return me;
      const friends = (accounts as Accounts).friends;
      const { incoming, outgoing } = friends.requests(me.account.id);
      const duos = (accounts as Accounts).duosOf(me.account.id);
      return ok({
        friends: friends
          .friendsOf(me.account.id)
          .map((row) => friendView(me.account.id, row, duos.get(row.id) ?? null)),
        incoming: incoming.map(requestView),
        outgoing: outgoing.map(requestView),
      });
    });

    // The search on the account page: the account that a whole username names, as names are
    // compared, with the handle that its public profile is read by. The hour's count is taken
    // before the name is looked up, so that a name that finds nobody costs as much as one that
    // finds someone (docs/architecture.md#threat-model).
    on(handlers, 'friends:find', ({ username }) => {
      const me = accountOf(conn);
      if (!me.ok) return me;
      if (!(accounts as Accounts).friends.takeFind(me.account.id)) return fail('friend_find_limited');
      const target = (accounts as Accounts).byName(username);
      if (!target) return fail('no_such_account');
      return ok({ handle: target.handle, username: target.username });
    });

    // A request to be friends, to an account by its username, or to a player in the room that the
    // connection is in, who must have an account. By username, the day's count is taken before the
    // name is looked up, so that trying names costs as much as asking. A player in the room is known
    // to have an account, so asking them costs one of the day's requests only if one goes out: it is
    // taken once the player is found, and given back if the request is refused. Both sides hear
    // that something changed.
    on(handlers, 'friends:request', ({ username, playerId, note: text }) => {
      const me = accountOf(conn);
      if (!me.ok) return me;
      // The line comes first, so that one that is too long costs none of the day's requests.
      const { note, problem } = checkFriendNote(text);
      if (problem) return fail(problem);
      const friends = (accounts as Accounts).friends;
      let target: Account | undefined;
      if (playerId !== undefined) {
        const found = membership(socket);
        if (!found) return fail('not_member');
        const other = found.room.members.get(playerId);
        if (!other) return fail('no_such_player');
        target = other.account ? accounts?.store.byId(other.account.id) : undefined;
      } else if (username !== undefined) {
        if (!friends.take(me.account.id)) return fail('friend_limited');
        target = (accounts as Accounts).byName(username);
      } else {
        return fail('bad_request');
      }
      if (!target) return fail('no_such_account');
      if (playerId !== undefined && !friends.take(me.account.id)) return fail('friend_limited');
      const result = friends.request(me.account.id, target.id, note);
      if (!result.ok) {
        if (playerId !== undefined) friends.refund(me.account.id);
        return result;
      }
      tellFriends(me.account.id, target.id);
      return ok({ status: result.status });
    });

    // The answers to a request, and the end of a friendship, each about the account the username
    // names. A name that is no account's is answered as one with no request, so that these can't
    // tell which names are taken (docs/architecture.md#threat-model).
    const about =
      (answer: 'accept' | 'decline' | 'remove') =>
      ({ username }: { username: string }): Reply => {
        const me = accountOf(conn);
        if (!me.ok) return me;
        const other = (accounts as Accounts).byName(username);
        if (!other) return fail('no_such_request');
        const result = (accounts as Accounts).friends[answer](me.account.id, other.id);
        if (!result.ok) return result;
        tellFriends(me.account.id, other.id);
        return ok();
      };
    // The name the account gives a friend, for itself alone: only its own connections hear that
    // something changed. A name that is no account's is answered as a stranger's.
    on(handlers, 'friends:alias', ({ username, alias: text }) => {
      const me = accountOf(conn);
      if (!me.ok) return me;
      const { alias, problem } = checkAlias(text);
      if (problem) return fail(problem);
      const other = (accounts as Accounts).byName(username);
      if (!other) return fail('not_friends');
      const result = (accounts as Accounts).friends.alias(me.account.id, other.id, alias);
      if (!result.ok) return result;
      tellAccount(me.account.id, 'friends:changed');
      return ok();
    });
    on(handlers, 'friends:accept', about('accept'));
    on(handlers, 'friends:decline', about('decline'));
    on(handlers, 'friends:remove', about('remove'));

    // A member invites a friend into the room, online or not, once a minute for the same friend;
    // a name that is no account's is answered as a stranger's. Every connection of the friend
    // hears it, and one that comes while it stands hears it then; what admits them, or doesn't, is
    // room:join's to say, except that whoever the chair has removed isn't invited to come and be
    // refused. The inviter gets the room again, with the friend among those they invited.
    on(handlers, 'friends:invite', ({ username }) => {
      const found = membership(socket);
      if (!found) return fail('not_member');
      const me = accountOf(conn);
      if (!me.ok) return me;
      const friend = (accounts as Accounts).byName(username);
      if (!friend || !(accounts as Accounts).friends.areFriends(me.account.id, friend.id)) return fail('not_friends');
      if (found.room.memberByKey(accountKey(friend.id))) return fail('friend_in_room');
      if (found.room.removal(accountKey(friend.id))) return fail('friend_removed');
      if (!invites.take(`${me.account.id}\n${friend.id}`)) return fail('invite_cooldown');
      const invitation = invitations.create(found.room, me.account.id, found.member.key, friend.id);
      tellAccount(friend.id, 'friends:invited', invitationView(invitation));
      send(found.room, found.member.sockets, { playerId: found.member.id });
      // An invitation answers whatever the friend asked to be let in, whoever they asked.
      asks.answered(found.room, friend.id);
      return ok();
    });

    // The account ignores an invitation of theirs: no connection of theirs hears it again.
    on(handlers, 'friends:ignore', ({ id }) => {
      const me = accountOf(conn);
      if (!me.ok) return me;
      invitations.ignore(id, me.account.id);
      return ok();
    });

    // The rooms that the account's friends are in, for the home page, each with the friends in it,
    // where the account has no seat itself; a private one without its code.
    on(handlers, 'friends:rooms', () => {
      const me = accountOf(conn);
      if (!me.ok) return me;
      const mine = accountKey(me.account.id);
      const found = new Map<Room, FriendRoomView>();
      for (const row of (accounts as Accounts).friends.friendsOf(me.account.id)) {
        const room = isOnline(row.id) ? roomOf(row.id) : undefined;
        if (!room || room.memberByKey(mine)) continue;
        const entry = found.get(room) ?? {
          code: room.public ? room.code : null,
          playing: room.phase !== 'lobby',
          friends: [],
        };
        const { handle, username, alias, avatar, asked } = friendView(me.account.id, row, null);
        entry.friends.push({ handle, username, ...(alias ? { alias } : {}), avatar, ...(asked ? { asked } : {}) });
        found.set(room, entry);
      }
      return ok({ rooms: [...found.values()] });
    });

    // The account asks a friend who is in a room to let it in, and learns nothing of the room by
    // asking: every connection of the friend hears it, and the friend invites the account
    // (friends:invite) or ignores it. One request stands at a time to the same friend, and an
    // account sends at most JOIN_ASKS_PER_HOUR an hour; one that is refused costs none. A name that
    // is no account's is answered as a stranger's.
    on(handlers, 'friends:ask', ({ username }) => {
      const me = accountOf(conn);
      if (!me.ok) return me;
      const friend = (accounts as Accounts).byName(username);
      if (!friend || !(accounts as Accounts).friends.areFriends(me.account.id, friend.id)) return fail('not_friends');
      const room = isOnline(friend.id) ? roomOf(friend.id) : undefined;
      const member = room?.memberByKey(accountKey(friend.id));
      if (!room || !member) return fail('friend_not_in_room');
      if (room.memberByKey(accountKey(me.account.id))) return fail('already_in_room');
      const removal = room.removal(accountKey(me.account.id));
      if (removal) return fail(removal);
      if (asks.between(me.account.id, friend.id)) return fail('join_ask_pending');
      if (!asking.take(String(me.account.id))) return fail('join_ask_limited');
      const ask = asks.create(room, me.account.id, friend.id, member.key);
      tellAccount(friend.id, 'friends:asked', askView(ask));
      tellAccount(me.account.id, 'friends:changed');
      return ok();
    });

    // The friend asked ignores a request: no connection of theirs hears it again, and the account
    // that asked hears only that it may ask again.
    on(handlers, 'friends:dismiss', ({ id }) => {
      const me = accountOf(conn);
      if (!me.ok) return me;
      asks.dismiss(id, me.account.id);
      return ok();
    });

    listen(socket, handlers);

    // A connection that is logged in counts for its account's presence from here on, and hears the
    // invitations and the requests to be let in that stand for the account, as its other
    // connections did when they came.
    if (conn.account) {
      const { id } = conn.account;
      const sockets = accountSockets.get(id) ?? new Set<string>();
      accountSockets.set(id, sockets.add(socket.id));
      for (const invitation of invitations.for(id)) socket.emit('friends:invited', invitationView(invitation));
      for (const ask of asks.for(id)) socket.emit('friends:asked', askView(ask));
    }

    socket.on('disconnect', () =>
      safely('disconnect', () => {
        if (conn.account) {
          const sockets = accountSockets.get(conn.account.id);
          sockets?.delete(socket.id);
          if (sockets?.size === 0) accountSockets.delete(conn.account.id);
        }
        release(socket);
      }),
    );
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
        const rank = accounts.rankOf(accountId);
        for (const room of rooms.all()) {
          const member = room.memberByKey(key);
          if (member && room.updateAccount(member.id, account.username, avatar, rank, account.agents)) broadcast(room);
        }
        // The account's own pages show the new name and avatar too, and so do its friends'.
        const session: Session = { version, account: { username: account.username, avatar } };
        for (const socket of connectionsOf(({ id }) => id === accountId)) socket.emit('session', session);
        tellFriends(...accounts.friends.others(accountId));
      },
      // An account that is gone leaves every room it was in, as if it had left, and the pages of
      // those who were its friends or had a request with it. Leaving asks the game module, and what
      // one room's module throws must not keep the account in the others.
      accountDeleted(accountId, others) {
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
        tellFriends(...others);
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
    // Each account is read once, with its rank, however many rooms it is in. Whether the operator has
    // let an account have AI players comes along, and with it whether its rooms may.
    const read = new Map<number, { account: Account; rank: Rank } | undefined>();
    for (const room of rooms.all()) {
      let differs = false;
      for (const member of room.members.values()) {
        if (!member.account) continue;
        const { id } = member.account;
        if (!read.has(id)) {
          const account = accounts.store.byId(id);
          read.set(id, account && { account, rank: accounts.rankOf(id) });
        }
        const known = read.get(id);
        if (!known) continue;
        const { account, rank } = known;
        if (room.updateAccount(member.id, account.username, avatarUrl(account), rank, account.agents)) differs = true;
      }
      const chair = room.chairId === null ? undefined : room.members.get(room.chairId);
      const account = chair?.account ? read.get(chair.account.id)?.account : undefined;
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
          cut(room, why);
          closeFor(sockets, 'expired');
          unschedule(room);
          driver?.forget(room);
          log('room_closed', { code: room.code, why });
        }
        for (const room of result.changed) broadcast(room);
        creations.prune();
        failedLookups.prune();
        feedbackSent.prune();
        reportsSent.prune();
        invites.prune();
        invitations.prune();
        asking.prune();
        asks.prune();
        for (const [key, time] of feedbackSeen) {
          if (now() - time >= limits.feedbackWindowMs) feedbackSeen.delete(key);
        }
      });
    },
    closeAll(reason) {
      for (const room of rooms.all()) shut(room, reason, reason);
      driver?.close();
    },
    connections() {
      return [...io.sockets.sockets.values()].map((socket) => ({
        transport: socket.conn.transport.name,
        country: connection(socket).country,
        latency: latencies.get(socket.conn) ?? null,
      }));
    },
    agents() {
      return driver ? driver.stats() : null;
    },
  };
}
