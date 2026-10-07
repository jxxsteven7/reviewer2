import { BOARD_SIZE, SPECTATOR, type KeywordsRoomData, type Seat } from '@reviewer2/shared';
import { KEYWORDS_MESSAGES, type KeywordsMessage } from '@reviewer2/shared/schemas';
import type { GameContext, GameModule, GameUpdate } from '../../core/game';
import { dropSelection, giveClue, newGame, pass, reveal, say, select, withdraw, type Outcome } from './rules';
import {
  changeSeat,
  emptySeating,
  endGame,
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

const fromOutcome = (data: KeywordsData, outcome: Outcome): GameUpdate<KeywordsData> =>
  outcome.ok ? { ok: true, data: { ...data, game: outcome.state } } : outcome;

// Whoever leaves their seat or the room takes their choice of a card with them.
const withoutSelection = (game: KeywordsState | null, playerId: string) => game && dropSelection(game, playerId);

// The seat rules of a game, which keep everyone in their group and key viewers out of the
// guessers' seats, hold from the start of a game until "play again" takes the room back to the
// waiting room: `data.game` is there for exactly that long. The room's phase would let go of
// them as soon as the game has ended, while the groups still have their chats.
const inGame = (data: KeywordsData) => data.game !== null;

function play(data: KeywordsData, ctx: GameContext, playerId: string, type: KeywordsMessage, payload: unknown) {
  const parsed = KEYWORDS_MESSAGES[type].safeParse(payload ?? {});
  if (!parsed.success) return { ok: false as const, error: 'bad_request' };
  const body = parsed.data;

  if (type === 'keywords:seat') {
    const { team, role } = body as { team: Seat['team']; role: Seat['role'] };
    const seat = { team, role } as Seat;
    const change = changeSeat(data.seating, { id: playerId, key: ctx.keyOf(playerId) }, seat, inGame(data));
    if (!change.ok) return change;
    const before = seatOf(data.seating, playerId);
    const moved = before.team !== seat.team || before.role !== seat.role;
    const game = moved ? withoutSelection(data.game, playerId) : data.game;
    return { ok: true as const, data: { seating: change.seating, game } };
  }

  // Once a game has ended, its actions still reach the rules, which answer stale or game_over in
  // the order of the checks. In the waiting room there is no game, so an action there is for an
  // earlier one, if any: stale, as the room answers a withdrawal or "play again" then.
  if (!data.game) return { ok: false as const, error: 'stale' };
  const actor = { id: playerId, ...seatOf(data.seating, playerId) };
  switch (type) {
    case 'keywords:clue':
      return fromOutcome(data, giveClue(data.game, actor, body as Parameters<typeof giveClue>[2]));
    case 'keywords:select':
      return fromOutcome(data, select(data.game, actor, body as Parameters<typeof select>[2]));
    case 'keywords:reveal':
      return fromOutcome(data, reveal(data.game, actor, body as Parameters<typeof reveal>[2]));
    case 'keywords:pass':
      return fromOutcome(data, pass(data.game, actor, body as Parameters<typeof pass>[2]));
    case 'keywords:say':
      return fromOutcome(data, say(data.game, actor, body as Parameters<typeof say>[2]));
  }
  return { ok: false as const, error: 'bad_request' };
}

export const keywordsGame: GameModule<KeywordsData, KeywordsRoomData> = {
  id: 'keywords',
  wordsNeeded: BOARD_SIZE,

  create: () => ({ seating: emptySeating(), game: null }),

  // Newcomers are spectators until they take a seat.
  join: (data) => data,

  // A captain who leaves frees the seat; the key viewers remember them anyway, and the groups
  // remember whom each player has played for.
  leave: (data, playerId) => ({
    seating: removeSeat(data.seating, playerId),
    game: withoutSelection(data.game, playerId),
  }),

  bench(data, ctx, playerId) {
    const change = changeSeat(data.seating, { id: playerId, key: ctx.keyOf(playerId) }, SPECTATOR, inGame(data));
    return change.ok ? { seating: change.seating, game: withoutSelection(data.game, playerId) } : data;
  },

  shuffle: (data, ctx) => ({ ...data, seating: shuffleGroups(data.seating, ctx.rng, online(ctx)) }),

  startProblems: (data, ctx) =>
    startProblems(data.seating, online(ctx)).map(({ problem, team }) => `${problem}:${team}`),

  start: (data, ctx, words, gameId) => ({
    seating: startGame(data.seating, ctx.keyOf),
    game: newGame(words, ctx.rng, gameId),
  }),

  isOver: (data) => data.game?.phase === 'over',

  withdraw: (data, gameId) =>
    data.game ? fromOutcome(data, withdraw(data.game, { gameId })) : { ok: false, error: 'stale' },

  // Back to the waiting room: everyone keeps their seat, and nobody has seen the next key or
  // played for a group yet.
  again: (data) => ({ seating: endGame(data.seating), game: null }),

  handle(data, ctx, playerId, type, payload) {
    if (!Object.hasOwn(KEYWORDS_MESSAGES, type)) return { ok: false, error: 'bad_request' };
    return play(data, ctx, playerId, type as KeywordsMessage, payload);
  },

  view(data, ctx, viewer) {
    const members = ctx.playerIds();
    const seats: Record<string, Seat> = {};
    for (const id of members) seats[id] = seatOf(data.seating, id);
    // What a viewer sees depends on the seat they are in right now (view.ts): a captain who has
    // stepped down to watch gets a spectator's view, and a screen always does.
    const seat = ('playerId' in viewer && seats[viewer.playerId]) || SPECTATOR;
    return {
      seats,
      keyViewers: members.filter((id) => data.seating.keyViewers.has(ctx.keyOf(id))),
      side: ('playerId' in viewer && data.seating.sides.get(ctx.keyOf(viewer.playerId))) || null,
      startProblems: ctx.phase === 'lobby' ? startProblems(data.seating, online(ctx)) : [],
      game: data.game ? viewFor(data.game, seat) : null,
    };
  },
};
