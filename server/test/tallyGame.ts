import type { RecordResult } from '@reviewer2/shared';
import type { GameModule, GameOutcome, PlayerResult } from '../src/core/game';
import type { GameLogEntry } from '../src/core/gameLog';

// A second game that exists only in the tests, to show that the shared layer runs a game unlike the
// first one without a change of its own (platform.test.ts). Everyone who came to play picks a
// number from 0 to 9 each round, in secret until the round closes, which it does once everyone
// still playing has picked; the game ends after the rounds its settings name. Whoever came only to
// watch, or came once the game had started, watches. It needs no words.
//
// - Each for themselves (the default): each player is a side of their own, by their player ID, and
//   scores the sum of their numbers. Their place is 1 and one more for each player who scored more,
//   so that players level share it. A player alone at the top wins and the others lose; players
//   level at the top draw, the others lose, and the game has no winner.
// - Together (`together`): everyone is one side and has place 1. They win together when, in every
//   round, everyone who picked a number picked the same one, and lose together otherwise, when the
//   game has no winner either.
//
// A player who leaves, or whom the chair benches, stops playing and is counted with the numbers
// they picked. Each player's record keeps their score and their numbers (TallyDetail), and their
// points are their score. In a match, the game's own options name the rounds of each of its games
// in place of the setting. The game brings no titles of its own: a match brings the match's.

export const TOGETHER = 'together';
const MAX_NUMBER = 9;
const MAX_ROUNDS = 5;

export interface TallySettings {
  together: boolean;
  rounds: number;
}

export interface TallyMatchOptions {
  rounds: number;
}

// What a player's record keeps of their game: their score, and the numbers they picked, round by
// round.
export interface TallyDetail {
  score: number;
  rounds: number[];
}

export interface TallyData extends TallySettings {
  // The rounds of each game of a match, as its options name them, or null outside a match.
  matchRounds: number | null;
  // Who has come to play the next game, in the order they came; the others watch.
  seats: string[];
  gameId: string | null;
  // Who plays the current game, and those of them who have left it or were benched since.
  players: string[];
  out: string[];
  // Each player's numbers in the rounds that have closed, how many have, and the numbers picked in
  // the round being played, which nobody but their player sees until it closes.
  picks: Record<string, number[]>;
  closed: number;
  pending: Record<string, number>;
  over: boolean;
  withdrawn: boolean;
}

export interface TallyView extends TallySettings {
  matchRounds: number | null;
  seats: string[];
  players: string[];
  out: string[];
  picks: Record<string, number[]>;
  closed: number;
  // Who has picked in the round being played, and the viewer's own number in it, if any.
  picked: string[];
  mine: number | null;
  over: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const hasKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => key in value);
const isWhole = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
const isSettings = (value: unknown): value is TallySettings =>
  isObject(value) &&
  hasKeys(value, ['together', 'rounds']) &&
  typeof value.together === 'boolean' &&
  isWhole(value.rounds, 1, MAX_ROUNDS);
const sum = (numbers: readonly number[]) => numbers.reduce((total, number) => total + number, 0);

// The number that a pick carries, or null when it carries none that will do.
const numberOf = (payload: unknown): number | null =>
  isObject(payload) && hasKeys(payload, ['number']) && isWhole(payload.number, 0, MAX_NUMBER) ? payload.number : null;

const roundsOf = (data: TallyData) => data.matchRounds ?? data.rounds;
const playing = (data: TallyData) => data.players.filter((id) => !data.out.includes(id));
const running = (data: TallyData) => data.gameId !== null && !data.over;

// How a game came out, from each player's numbers, round by round, the same for the game as it ends
// and for its log counted again: everyone's part in it, and who won.
export function tally(
  together: boolean,
  picks: ReadonlyMap<string, readonly number[]>,
): { results: PlayerResult[]; outcome: GameOutcome } {
  const ids = [...picks.keys()];
  const detail = (id: string): TallyDetail => {
    const rounds = [...(picks.get(id) ?? [])];
    return { score: sum(rounds), rounds };
  };
  if (together) {
    const longest = Math.max(0, ...ids.map((id) => picks.get(id)?.length ?? 0));
    const agreed = Array.from(
      { length: longest },
      (_, round) => new Set(ids.flatMap((id) => picks.get(id)?.[round] ?? [])),
    ).every((numbers) => numbers.size <= 1);
    const result: RecordResult = agreed ? 'won' : 'lost';
    return {
      results: ids.map((playerId) => ({
        playerId,
        side: TOGETHER,
        role: 'player',
        result,
        place: 1,
        verdict: agreed ? 'agreed' : 'apart',
        detail: detail(playerId),
      })),
      outcome: { winner: agreed ? TOGETHER : null, reason: agreed ? 'agreed' : 'apart' },
    };
  }
  const score = (id: string) => sum(picks.get(id) ?? []);
  const best = Math.max(...ids.map(score));
  const top = ids.filter((id) => score(id) === best);
  const alone = top.length === 1;
  return {
    results: ids.map((playerId) => {
      const place = 1 + ids.filter((other) => score(other) > score(playerId)).length;
      const result: RecordResult = place > 1 ? 'lost' : alone ? 'won' : 'drawn';
      const verdict = result === 'won' ? 'first' : result === 'drawn' ? 'level' : 'behind';
      return { playerId, side: playerId, role: 'player', result, place, verdict, detail: detail(playerId) };
    }),
    outcome: { winner: alone ? (top[0] as string) : null, reason: alone ? 'highest' : 'level' },
  };
}

const picksOf = (data: TallyData) => new Map(data.players.map((id) => [id, data.picks[id] ?? []]));

// Closes the round once everyone still playing has picked, and ends the game after its last round,
// or as soon as nobody is playing any more, with the numbers picked so far.
function settle(data: TallyData): TallyData {
  const left = playing(data);
  if (left.length > 0 && !left.every((id) => id in data.pending)) return data;
  const picks = { ...data.picks };
  for (const [id, number] of Object.entries(data.pending)) picks[id] = [...(picks[id] ?? []), number];
  const closed = data.closed + (Object.keys(data.pending).length > 0 ? 1 : 0);
  return { ...data, picks, closed, pending: {}, over: left.length === 0 || closed >= roundsOf(data) };
}

// A player who leaves the room or the seats: no seat for the next game, and out of the current one.
function unseat(data: TallyData, id: string): TallyData {
  const seats = data.seats.filter((other) => other !== id);
  if (!running(data) || !playing(data).includes(id)) return { ...data, seats };
  return settle({ ...data, seats, out: [...data.out, id] });
}

// The log of a game that finished, as far as it goes before its end, or null for one that didn't.
function finished(entries: readonly GameLogEntry[]): GameLogEntry[] | null {
  const end = entries.findIndex(({ type }) => type === 'end');
  return end === -1 || entries[end]?.data !== undefined ? null : entries.slice(0, end);
}

// Who played in a kept game, as its log seats them when it began, and what each of them picked, in
// the order they picked: their numbers round by round, since each picks once a round.
function picksIn(start: Record<string, unknown> | null, entries: readonly GameLogEntry[]) {
  const picks = new Map<string, number[]>();
  for (const [id, seat] of Object.entries(start ?? {})) if (seat === 'player') picks.set(id, []);
  for (const { by, type, data } of entries) {
    if (type === 'tally:play' && by !== null) picks.get(by)?.push(data as number);
  }
  return picks;
}

const isSetup = isSettings;

export const tallyGame: GameModule<TallyData, TallyView> = {
  id: 'tally',
  rulesVersion: 1,
  titles: [],
  wordsNeeded: 0,
  create: () => ({
    together: false,
    rounds: 2,
    matchRounds: null,
    seats: [],
    gameId: null,
    players: [],
    out: [],
    picks: {},
    closed: 0,
    pending: {},
    over: false,
    withdrawn: false,
  }),
  configure(data, _ctx, settings) {
    if (!isSettings(settings)) return { ok: false, error: 'bad_settings' };
    const { together, rounds } = settings;
    return {
      ok: true,
      data: together === data.together && rounds === data.rounds ? data : { ...data, together, rounds },
    };
  },
  settingsOf: ({ together, rounds }) => ({ together, rounds }),
  deadline: () => null,
  tick: (data) => data,
  join: (data, _ctx, id, play) => (play ? { ...data, seats: [...data.seats, id] } : data),
  leave: (data, id) => unseat(data, id),
  bench: (data, _ctx, id) => unseat(data, id),
  shuffle: (data) => data,
  canStart: (data, ctx) => data.seats.filter((id) => ctx.isOnline(id)).length >= 2,
  start: (data, ctx, _words, gameId) => ({
    ...data,
    gameId,
    players: data.seats.filter((id) => ctx.isOnline(id)),
    out: [],
    picks: {},
    closed: 0,
    pending: {},
    over: false,
    withdrawn: false,
  }),
  isOver: (data) => data.over,
  withdraw(data, gameId) {
    if (gameId !== data.gameId) return { ok: false, error: 'stale' };
    if (data.over) return { ok: false, error: 'game_over' };
    return { ok: true, data: { ...data, over: true, withdrawn: true } };
  },
  again: (data) => ({ ...data, gameId: null, players: [], out: [], picks: {}, closed: 0, pending: {}, over: false }),
  handle(data, ctx, playerId, type, payload) {
    if (type !== 'tally:play') return { ok: false, error: 'bad_request' };
    if (ctx.phase !== 'playing' || !running(data)) return { ok: false, error: 'wrong_phase' };
    if (!playing(data).includes(playerId)) return { ok: false, error: 'not_playing' };
    const number = numberOf(payload);
    if (number === null) return { ok: false, error: 'bad_number' };
    if (playerId in data.pending) return { ok: false, error: 'picked_already' };
    return { ok: true, data: settle({ ...data, pending: { ...data.pending, [playerId]: number } }) };
  },
  results: (data) => (data.withdrawn ? null : tally(data.together, picksOf(data)).results),
  outcome: (data) => (data.withdrawn ? null : tally(data.together, picksOf(data)).outcome),
  // How the game began: whether everyone played together, and how many rounds it had. Who played
  // is in the log, where it began.
  setup: (data) => ({ together: data.together, rounds: roundsOf(data) }),
  seated: (data, id) => (data.players.includes(id) ? 'player' : 'watcher'),
  participants: (data, ctx) => data.players.map((id) => ctx.keyOf(id)),
  logged: (type, payload) => (type === 'tally:play' ? { data: numberOf(payload) } : {}),
  // A kept game that finished, counted again from how it began and its log, as tally() counted it
  // when it ended, with everyone's score as their points.
  recount: ({ setup, log, keyOf }) => {
    const entries = finished(log.entries);
    if (entries === null || !isSetup(setup)) return null;
    const picks = picksIn(log.start, entries);
    const { results, outcome } = tally(setup.together, picks);
    return {
      results,
      outcome,
      scores: [...picks].map(([id, rounds]) => ({
        key: keyOf(id),
        points: sum(rounds),
        detail: { score: sum(rounds), rounds },
      })),
    };
  },
  // A finished game, watched again: how it was played, everyone's numbers round by round, with the
  // accounts as they are now, and who is watching.
  showReplay: ({ setup, log, accounts, viewer }) => {
    const entries = finished(log.entries);
    if (entries === null || !isSetup(setup)) return null;
    const picks = picksIn(log.start, entries);
    return {
      ...setup,
      players: [...picks].map(([playerId, rounds]) => ({
        playerId,
        username: accounts.get(playerId)?.username ?? null,
        rounds,
      })),
      outcome: tally(setup.together, picks).outcome,
      viewer: [...viewer],
    };
  },
  shapes: {
    setup: isSetup,
    settings: isSettings,
    role: (role) => role === 'player',
    detail: (value) =>
      isObject(value) &&
      hasKeys(value, ['score', 'rounds']) &&
      Array.isArray(value.rounds) &&
      value.rounds.every((number) => isWhole(number, 0, MAX_NUMBER)) &&
      value.score === sum(value.rounds as number[]),
    // No AI player ever takes a seat.
    feats: () => false,
  },
  match: {
    options: (value) =>
      isObject(value) && hasKeys(value, ['rounds']) && isWhole(value.rounds, 1, MAX_ROUNDS)
        ? { rounds: value.rounds }
        : null,
    setup: (data, _ctx, rules) => ({
      ...data,
      matchRounds: rules === null ? null : (rules.options as TallyMatchOptions).rounds,
    }),
    score: (data, ctx) =>
      data.withdrawn
        ? null
        : data.players.map((id) => {
            const rounds = data.picks[id] ?? [];
            return { key: ctx.keyOf(id), points: sum(rounds), detail: { score: sum(rounds), rounds } };
          }),
    lineup: (data) => data.players,
  },
  views: (data) => (viewer) => ({
    together: data.together,
    rounds: data.rounds,
    matchRounds: data.matchRounds,
    seats: data.seats,
    players: data.players,
    out: data.out,
    picks: data.picks,
    closed: data.closed,
    picked: Object.keys(data.pending),
    mine: 'playerId' in viewer ? (data.pending[viewer.playerId] ?? null) : null,
    over: data.over,
  }),
};
