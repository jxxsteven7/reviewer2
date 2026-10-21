import type { GameModule } from '../src/core/game';

// A tiny game for testing the shared layer. Players press a button; each viewer sees a line
// meant only for them, which shows whether snapshots are really built per connection. A player can
// also break one part of the game, which then throws until someone mends it, and set an alarm,
// which rings by itself at its time, say something, as in a chat, and sit back after being moved
// to the spectators, which is a change of seat rather than a move. The game has one setting, a
// level from 1 to 3. A game that is finished, rather than withdrawn, is won by everyone who came to
// play, for the records, and brings whoever said something in it the Deadline Hero title, so that
// the titles of the records can be tested; it scores no points. What it counts of an AI player in a
// seat is the presses of the whole game, which its page adds up.

export interface FakeData {
  joined: string[];
  // The newcomers who came to play rather than to watch.
  players: string[];
  benched: string[];
  presses: number;
  words: string[];
  gameId: string | null;
  over: boolean;
  withdrawn: boolean;
  broken: 'join' | 'leave' | 'view' | 'configure' | 'tick' | null;
  // The one player for whom the broken part throws, or null when it throws for everyone.
  brokenFor: string | null;
  // A fragile game ends as soon as a player leaves it or is moved to the spectators.
  fragile: boolean;
  language: string;
  level: number;
  // When the alarm rings, on the room's clock, and how often it has rung.
  alarm: number | null;
  rings: number;
  // How many things have been said, and by whom.
  said: number;
  talkers: string[];
}

// The view leaves the game's ID out on purpose: the chair's controls have to work with what the
// room itself says, whatever a game puts into its own part.
export interface FakeView {
  players: string[];
  presses: number;
  words: string[];
  benched: string[];
  forViewer: string;
  level: number;
  rings: number;
}

interface Breakage {
  what: string;
  only?: string | null;
}

const isLevel = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 3;
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const fakeGame: GameModule<FakeData, FakeView> = {
  id: 'test',
  rulesVersion: 7,
  // The one title that it brings, which the first game has too: no other game is played beside it.
  titles: ['deadline_hero'],
  words: { board: 3 },
  create: (language) => ({
    joined: [],
    players: [],
    benched: [],
    presses: 0,
    words: [],
    gameId: null,
    over: false,
    withdrawn: false,
    broken: null,
    brokenFor: null,
    fragile: false,
    language,
    level: 1,
    alarm: null,
    rings: 0,
    said: 0,
    talkers: [],
  }),
  configure(data, _ctx, settings) {
    const { level } = (settings ?? {}) as { level?: unknown };
    if (data.broken === 'configure') throw new Error('configuring broke');
    if (!isLevel(level)) return { ok: false, error: 'bad_settings' };
    return { ok: true, data: level === data.level ? data : { ...data, level } };
  },
  settingsOf: (data) => ({ level: data.level }),
  deadline: (data) => data.alarm,
  tick(data, ctx) {
    if (data.broken === 'tick') throw new Error('ticking broke');
    if (data.alarm === null || ctx.now() < data.alarm) return data;
    return { ...data, alarm: null, rings: data.rings + 1 };
  },
  join(data, _ctx, id, play) {
    if (data.broken === 'join') throw new Error('joining broke');
    return { ...data, joined: [...data.joined, id], players: play ? [...data.players, id] : data.players };
  },
  leave(data, id) {
    if (data.broken === 'leave' && (data.brokenFor === null || data.brokenFor === id)) throw new Error('leaving broke');
    return { ...data, joined: data.joined.filter((other) => other !== id), over: data.over || data.fragile };
  },
  bench: (data, _ctx, id) => ({ ...data, benched: [...data.benched, id], over: data.over || data.fragile }),
  shuffle: (data) => ({ ...data, joined: [...data.joined].reverse() }),
  canStart: (data, ctx) => data.joined.filter((id) => ctx.isOnline(id)).length >= 2,
  start: (data, _ctx, words, gameId) => ({
    ...data,
    words: words.map(({ word }) => word),
    gameId,
    presses: 0,
    over: false,
    withdrawn: false,
    talkers: [],
  }),
  isOver: (data) => data.over,
  withdraw(data, gameId) {
    if (gameId !== data.gameId) return { ok: false, error: 'stale' };
    if (data.over) return { ok: false, error: 'game_over' };
    return { ok: true, data: { ...data, over: true, withdrawn: true } };
  },
  results: (data) =>
    data.withdrawn
      ? null
      : data.players.map((playerId) => ({
          playerId,
          side: 'all',
          role: 'player',
          result: 'won' as const,
          place: 1,
          verdict: `pressed ${data.presses}`,
          titles: data.talkers.includes(playerId) ? [{ title: 'deadline_hero' as const, turn: 1 }] : [],
        })),
  // How the game began, for its record: the words. How it came out: everyone won, by finishing.
  setup: (data) => ({ words: data.words }),
  outcome: (data) => (data.withdrawn ? null : { winner: 'all', reason: 'finish' }),
  agentFeats: (data) => ({ presses: data.presses }),
  agentTotals: (feats) => ({
    presses: (feats as { presses: number }[]).reduce((sum, { presses }) => sum + presses, 0),
  }),
  // A finished game, watched again: how many presses its log has before its end, and the words,
  // which no one but the players should read back from the database. A game that didn't finish has
  // nothing to watch.
  showReplay: ({ setup, log }) => {
    const end = log.entries.findIndex(({ type }) => type === 'end');
    if (end === -1 || log.entries[end]?.data !== undefined) return null;
    const presses = log.entries.slice(0, end).filter(({ type }) => type === 'test:press').length;
    return { presses, words: (setup as { words: string[] }).words };
  },
  // Whoever came to play has played, also after leaving, and is a player wherever they are; the
  // others watch. The log keeps what a press carried and what was said. The game waits for its
  // players while the alarm is set.
  participants: (data, ctx) => data.players.map((id) => ctx.keyOf(id)),
  // A kept game counted again (store/recount.ts), as results() counts it: everyone who came to play,
  // as the log seats them, won by finishing, with the presses in the verdict and the title for
  // whoever said something, no points, and the presses for an AI player. A game that didn't finish
  // counts for nothing.
  recount: ({ log, keyOf }) => {
    const end = log.entries.findIndex(({ type }) => type === 'end');
    if (end === -1 || log.entries[end]?.data !== undefined) return null;
    const before = log.entries.slice(0, end);
    const presses = before.filter(({ type }) => type === 'test:press').length;
    const players = Object.entries(log.start ?? {})
      .filter(([, seat]) => seat === 'player')
      .map(([id]) => id);
    for (const { by, type, data } of before) {
      if (type === 'join' && by !== null && (data as { seat?: unknown } | undefined)?.seat === 'player')
        players.push(by);
    }
    const talkers = new Set(before.filter(({ type }) => type === 'test:say').map(({ by }) => by));
    const results = players.map((playerId) => ({
      playerId,
      side: 'all',
      role: 'player',
      result: 'won' as const,
      place: 1,
      verdict: `pressed ${presses}`,
      titles: talkers.has(playerId) ? [{ title: 'deadline_hero' as const, turn: 1 }] : [],
    }));
    return {
      results,
      scores: players.map((playerId) => ({ key: keyOf(playerId), points: 0, detail: null })),
      outcome: { winner: 'all', reason: 'finish' },
      feats: () => ({ presses }),
    };
  },
  // The shapes of the game's own, for the check of the data: how a game began, its one setting, its
  // one role, no detail of a record, and what it counts of an AI player.
  shapes: {
    setup: (value) =>
      isObject(value) && Array.isArray(value.words) && value.words.every((word) => typeof word === 'string'),
    settings: (value) => isObject(value) && isLevel(value.level),
    role: (role) => role === 'player',
    detail: (value) => value === null,
    feats: (value) => isObject(value) && Number.isInteger(value.presses),
  },
  seated: (data, id) => (data.players.includes(id) ? 'player' : 'watcher'),
  logged: (type, payload) =>
    type === 'test:press'
      ? { data: payload ?? null }
      : type === 'test:say'
        ? { said: String(payload) }
        : type === 'test:sit'
          ? { seat: true }
          : {},
  due: (data) => (data.alarm === null ? [] : data.players),
  again: (data) => ({ ...data, words: [], gameId: null, over: false, alarm: null }),
  handle(data, ctx, _playerId, type, payload) {
    if (type === 'test:break') {
      // What to break, or what to break and for whom.
      const { what, only = null } = typeof payload === 'string' ? { what: payload } : (payload as Breakage);
      return { ok: true, data: { ...data, broken: what as FakeData['broken'], brokenFor: only } };
    }
    if (type === 'test:mend') return { ok: true, data: { ...data, broken: null, brokenFor: null } };
    // A message that is granted but changes nothing.
    if (type === 'test:nothing') return { ok: true, data };
    if (type === 'test:fragile') return { ok: true, data: { ...data, fragile: true } };
    // A refusal with more in it than a code: something that the game knows, and something that
    // can't be sent at all.
    if (type === 'test:refuse') return { ok: false, error: 'odd', secret: data.words, count: 10n } as never;
    // A module may throw anything at all, not only errors.
    if (type === 'test:throw') throw payload;
    if (ctx.phase !== 'playing') return { ok: false, error: 'wrong_phase' };
    if (type === 'test:press') return { ok: true, data: { ...data, presses: data.presses + 1 } };
    if (type === 'test:say') {
      const talkers = data.talkers.includes(_playerId) ? data.talkers : [...data.talkers, _playerId];
      return { ok: true, data: { ...data, said: data.said + 1, talkers } };
    }
    // A player who was moved to the spectators sits back: a change of seat, not a move of the game.
    if (type === 'test:sit')
      return { ok: true, data: { ...data, benched: data.benched.filter((id) => id !== _playerId) } };
    if (type === 'test:finish') return { ok: true, data: { ...data, over: true, alarm: null } };
    // The alarm rings this many milliseconds from now, by the room's clock.
    if (type === 'test:alarm') return { ok: true, data: { ...data, alarm: ctx.now() + (payload as number) } };
    if (type === 'test:explode') throw new Error('the game broke');
    return { ok: false, error: 'bad_request' };
  },
  views(data) {
    if (data.broken === 'view') throw new Error('the view broke');
    return (viewer) => ({
      players: data.players,
      presses: data.presses,
      words: data.words,
      benched: data.benched,
      forViewer: 'playerId' in viewer ? `for ${viewer.playerId}` : 'for screens',
      level: data.level,
      rings: data.rings,
    });
  },
};
