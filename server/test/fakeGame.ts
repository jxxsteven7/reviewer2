import type { GameModule } from '../src/core/game';

// A tiny game for testing the shared layer. Players press a button; each viewer sees a line
// meant only for them, which shows whether snapshots are really built per connection. A player can
// also break one part of the game, which then throws until someone mends it, and set an alarm,
// which rings by itself at its time, and say something, as in a chat. The game has one setting, a
// level from 1 to 3. A game that is finished, rather than withdrawn, is won by everyone who came to
// play, for the records.

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
  // How many things have been said.
  said: number;
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

export const fakeGame: GameModule<FakeData, FakeView> = {
  id: 'test',
  rulesVersion: 7,
  wordsNeeded: 3,
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
          winner: 'all',
          won: true,
          verdict: `pressed ${data.presses}`,
        })),
  // How the game began, for its record: the words. How it came out: everyone won, by finishing.
  setup: (data) => ({ words: data.words }),
  outcome: (data) => (data.withdrawn ? null : { winner: 'all', reason: 'finish' }),
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
  seated: (data, id) => (data.players.includes(id) ? 'player' : 'watcher'),
  logged: (type, payload) =>
    type === 'test:press' ? { data: payload ?? null } : type === 'test:say' ? { said: String(payload) } : {},
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
    if (type === 'test:say') return { ok: true, data: { ...data, said: data.said + 1 } };
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
