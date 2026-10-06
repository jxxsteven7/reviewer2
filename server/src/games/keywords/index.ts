import {
  BOARD_SIZE,
  KEYWORDS_MESSAGES,
  SPECTATOR,
  type KeywordsMessage,
  type KeywordsRoomData,
  type Seat,
} from '@reviewer2/shared';
import type { GameContext, GameModule, GameResult } from '../../core/game';
import { giveClue, newGame, pass, reveal, withdraw, type Outcome } from './rules';
import {
  changeSeat,
  emptySeating,
  removeSeat,
  seatOf,
  shuffleGroups,
  startGame,
  startProblems,
  type Seating,
} from './seats';
import type { KeywordsState } from './state';
import { viewFor } from './view';

// The team word guessing game as a GameModule: the rules in rules.ts and seats.ts, connected to
// a room. docs/games/keywords.md describes the game.

export interface KeywordsData {
  seating: Seating;
  game: KeywordsState | null;
}

const online = (ctx: GameContext) => new Set(ctx.playerIds().filter((id) => ctx.isOnline(id)));

const fromOutcome = (data: KeywordsData, outcome: Outcome): GameResult<KeywordsData> =>
  outcome.ok ? { ok: true, data: { ...data, game: outcome.state } } : outcome;

function play(data: KeywordsData, ctx: GameContext, playerId: string, type: KeywordsMessage, payload: unknown) {
  const parsed = KEYWORDS_MESSAGES[type].safeParse(payload ?? {});
  if (!parsed.success) return { ok: false as const, error: 'bad_request' };
  const body = parsed.data;

  if (type === 'keywords:seat') {
    const { team, role } = body as { team: Seat['team']; role: Seat['role'] };
    const seat = { team, role } as Seat;
    const change = changeSeat(data.seating, { id: playerId, key: ctx.keyOf(playerId) }, seat, ctx.phase === 'playing');
    return change.ok ? { ok: true as const, data: { ...data, seating: change.seating } } : change;
  }

  if (ctx.phase !== 'playing' || !data.game) return { ok: false as const, error: 'wrong_phase' };
  const actor = seatOf(data.seating, playerId);
  switch (type) {
    case 'keywords:clue':
      return fromOutcome(data, giveClue(data.game, actor, body as Parameters<typeof giveClue>[2]));
    case 'keywords:reveal':
      return fromOutcome(data, reveal(data.game, actor, body as Parameters<typeof reveal>[2]));
    case 'keywords:pass':
      return fromOutcome(data, pass(data.game, actor, body as Parameters<typeof pass>[2]));
  }
  return { ok: false as const, error: 'bad_request' };
}

export const keywordsGame: GameModule<KeywordsData, KeywordsRoomData> = {
  id: 'keywords',
  wordsNeeded: BOARD_SIZE,

  create: () => ({ seating: emptySeating(), game: null }),

  // Newcomers are spectators until they take a seat.
  join: (data) => data,

  // A captain who leaves frees the seat; the key viewers remember them anyway.
  leave: (data, playerId) => ({ ...data, seating: removeSeat(data.seating, playerId) }),

  bench(data, ctx, playerId) {
    const change = changeSeat(
      data.seating,
      { id: playerId, key: ctx.keyOf(playerId) },
      SPECTATOR,
      ctx.phase === 'playing',
    );
    return change.ok ? { ...data, seating: change.seating } : data;
  },

  shuffle: (data, ctx) => ({ ...data, seating: shuffleGroups(data.seating, ctx.rng) }),

  startProblems: (data, ctx) =>
    startProblems(data.seating, online(ctx)).map(({ problem, team }) => `${problem}:${team}`),

  start: (data, ctx, words, gameId) => ({
    seating: startGame(data.seating, ctx.keyOf),
    game: newGame(words, ctx.rng, gameId),
  }),

  isOver: (data) => data.game?.phase === 'over',

  withdraw: (data) => (data.game ? { ...data, game: withdraw(data.game) } : data),

  // Back to the waiting room: everyone keeps their seat, and nobody has seen the next key yet.
  again: (data) => ({ seating: { seats: data.seating.seats, keyViewers: new Set() }, game: null }),

  handle(data, ctx, playerId, type, payload) {
    if (!Object.hasOwn(KEYWORDS_MESSAGES, type)) return { ok: false, error: 'bad_request' };
    return play(data, ctx, playerId, type as KeywordsMessage, payload);
  },

  view(data, ctx, viewer) {
    const members = ctx.playerIds();
    const seats: Record<string, Seat> = {};
    for (const id of members) seats[id] = seatOf(data.seating, id);
    // Only a member who sits as a captain right now sees the key. A captain who has stepped down
    // to watch gets the public view again, and screens always do.
    const sees = 'playerId' in viewer && seats[viewer.playerId]?.role === 'captain' ? 'key' : 'public';
    return {
      seats,
      keyViewers: members.filter((id) => data.seating.keyViewers.has(ctx.keyOf(id))),
      startProblems: ctx.phase === 'lobby' ? startProblems(data.seating, online(ctx)) : [],
      game: data.game ? viewFor(data.game, sees) : null,
    };
  },
};
