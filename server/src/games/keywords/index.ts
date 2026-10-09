import {
  BOARD_SIZE,
  defaultSettings,
  sameSettings,
  settingsProblems,
  SPECTATOR,
  type KeywordsRoomData,
  type KeywordsSettings,
  type KeywordsView,
  type Seat,
} from '@reviewer2/shared';
import { KEYWORDS_MESSAGES, KEYWORDS_SETTINGS, type KeywordsMessage } from '@reviewer2/shared/schemas';
import type { z } from 'zod';
import { fail } from '../../core/answers';
import type { GameContext, GameModule, GameUpdate } from '../../core/game';
import {
  dropSelection,
  expire,
  giveClue,
  newGame,
  pass,
  reveal,
  say,
  select,
  withdraw,
  type Actor,
  type Outcome,
} from './rules';
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
  type SeatRequest,
} from './seats';
import type { KeywordsState } from './state';
import { viewFor } from './view';

// The team word guessing game as a GameModule: the rules in rules.ts and seats.ts, connected to
// a room. docs/games/keywords.md describes the game.

export interface KeywordsData {
  // The room's settings. A game takes them along when it starts.
  settings: KeywordsSettings;
  seating: Seating;
  game: KeywordsState | null;
}

const online = (ctx: GameContext) => new Set(ctx.playerIds().filter((id) => ctx.isOnline(id)));

// The rules give the state back as it is when an action changed nothing, and then so does the
// module: the room sends no snapshot for that.
const fromOutcome = (data: KeywordsData, outcome: Outcome): GameUpdate<KeywordsData> => {
  if (!outcome.ok) return outcome;
  return { ok: true, data: outcome.state === data.game ? data : { ...data, game: outcome.state } };
};

const withoutSelection = (game: KeywordsState | null, playerId: string) => game && dropSelection(game, playerId);

// The seat rules of a game, which keep everyone in their group and key viewers out of the
// guessers' seats, hold from the start of a game until "play again" takes the room back to the
// waiting room: `data.game` is there for exactly that long. The room's phase would let go of
// them as soon as the game has ended, while the groups still have their chats.
const inGame = (data: KeywordsData) => data.game !== null;

// Moves a player to the seat they ask for, or to the spectators when the chair benches them.
// Whoever leaves their seat takes their choice of a card with them (rules.ts); whoever asks for
// the seat they are in changes nothing.
function sit(data: KeywordsData, ctx: GameContext, playerId: string, wanted: SeatRequest): GameUpdate<KeywordsData> {
  const change = changeSeat(data.seating, { id: playerId, key: ctx.keyOf(playerId) }, wanted, inGame(data));
  if (!change.ok) return change;
  if (change.seating === data.seating) return { ok: true, data };
  return { ok: true, data: { ...data, seating: change.seating, game: withoutSelection(data.game, playerId) } };
}

// An action on the game, which the rules judge for the player in the seat they are in right
// now. Once a game has ended, its actions still reach the rules, which answer stale or game_over
// in the order of the checks. In the waiting room there is no game, so an action there is for an
// earlier one, if any: stale, as the room answers a withdrawal or "play again" then.
function act(data: KeywordsData, playerId: string, rule: (game: KeywordsState, actor: Actor) => Outcome) {
  if (!data.game) return fail('stale');
  return fromOutcome(data, rule(data.game, { id: playerId, ...seatOf(data.seating, playerId) }));
}

// What the game does on each of its messages, with the payload as the message's schema reads it.
// Each action hands the rules exactly what its schema gives, so that a field which is named one
// way in the schema and another in the rules doesn't compile, and neither does a message without
// an action.
type Payload<M extends KeywordsMessage> = z.infer<(typeof KEYWORDS_MESSAGES)[M]>;
type Action<M extends KeywordsMessage> = (
  data: KeywordsData,
  ctx: GameContext,
  playerId: string,
  payload: Payload<M>,
) => GameUpdate<KeywordsData>;

const actions: { [M in KeywordsMessage]: Action<M> } = {
  'keywords:seat': (data, ctx, playerId, seat) => sit(data, ctx, playerId, seat),
  'keywords:clue': (data, ctx, playerId, clue) =>
    act(data, playerId, (game, actor) => giveClue(game, actor, clue, ctx.now())),
  'keywords:select': (data, _ctx, playerId, choice) =>
    act(data, playerId, (game, actor) => select(game, actor, choice)),
  'keywords:reveal': (data, ctx, playerId, guess) =>
    act(data, playerId, (game, actor) => reveal(game, actor, guess, ctx.now())),
  'keywords:pass': (data, ctx, playerId, moment) =>
    act(data, playerId, (game, actor) => pass(game, actor, moment, ctx.now())),
  'keywords:say': (data, _ctx, playerId, line) => act(data, playerId, (game, actor) => say(game, actor, line)),
};

export const keywordsGame: GameModule<KeywordsData, KeywordsRoomData> = {
  id: 'keywords',
  wordsNeeded: BOARD_SIZE,

  create: (language) => ({ settings: defaultSettings(language), seating: emptySeating(), game: null }),

  // The settings come whole, and must suit the room's language: a Chinese room counts the clue's
  // characters, an English room its words.
  configure(data, ctx, settings) {
    const parsed = KEYWORDS_SETTINGS.safeParse(settings);
    if (!parsed.success || Object.keys(settingsProblems(parsed.data, ctx.language)).length > 0) {
      return fail('bad_settings');
    }
    return { ok: true, data: sameSettings(parsed.data, data.settings) ? data : { ...data, settings: parsed.data } };
  },

  // Newcomers are spectators until they take a seat.
  join: (data) => data,

  // A captain who leaves frees the seat; the key viewers remember them anyway, and the groups
  // remember whom each player has played for.
  leave: (data, playerId) => ({
    ...data,
    seating: removeSeat(data.seating, playerId),
    game: withoutSelection(data.game, playerId),
  }),

  bench(data, ctx, playerId) {
    const seated = sit(data, ctx, playerId, SPECTATOR);
    return seated.ok ? seated.data : data;
  },

  shuffle: (data, ctx) => ({ ...data, seating: shuffleGroups(data.seating, ctx.rng, online(ctx)) }),

  canStart: (data, ctx) => startProblems(data.seating, online(ctx)).length === 0,

  start: (data, ctx, words, gameId) => ({
    ...data,
    seating: startGame(data.seating, ctx.keyOf),
    game: newGame(words, ctx.rng, { gameId, settings: data.settings, language: ctx.language }, ctx.now()),
  }),

  // A game that is over has no clock.
  deadline: (data) => data.game?.clock?.ends ?? null,

  tick(data, ctx) {
    if (!data.game) return data;
    const game = expire(data.game, ctx.now());
    return game === data.game ? data : { ...data, game };
  },

  isOver: (data) => data.game?.phase === 'over',

  withdraw: (data, gameId) => (data.game ? fromOutcome(data, withdraw(data.game, { gameId })) : fail('stale')),

  again: (data) => ({ ...data, seating: endGame(data.seating), game: null }),

  handle(data, ctx, playerId, type, payload) {
    if (!Object.hasOwn(KEYWORDS_MESSAGES, type)) return fail('bad_request');
    const message = type as KeywordsMessage;
    const parsed = KEYWORDS_MESSAGES[message].safeParse(payload ?? {});
    if (!parsed.success) return fail('bad_request');
    // The schema and the action of one message go together, which the types can't see across a
    // lookup by name, as in socket.ts.
    return (actions[message] as Action<KeywordsMessage>)(data, ctx, playerId, parsed.data);
  },

  views(data, ctx) {
    const members = ctx.playerIds();
    // The seats are copied, so that a snapshot shares nothing with the room's own state.
    const seats: Record<string, Seat> = {};
    for (const id of members) seats[id] = { ...seatOf(data.seating, id) };
    const at = ctx.now();
    const shared = {
      settings: { ...data.settings },
      seats,
      keyViewers: members.filter((id) => data.seating.keyViewers.has(ctx.keyOf(id))),
      startProblems: ctx.phase === 'lobby' ? startProblems(data.seating, online(ctx)) : [],
    };
    // What a viewer sees of the game depends on the seat they are in right now (view.ts): a
    // captain who has stepped down to watch gets a spectator's view, and a screen always does.
    // So there are at most five views of a game, one for each seat, and each is built once.
    const boards = new Map<string, KeywordsView | null>();
    return (viewer) => {
      const seat = ('playerId' in viewer && seats[viewer.playerId]) || SPECTATOR;
      const key = `${seat.team}:${seat.role}`;
      let game = boards.get(key);
      if (game === undefined) boards.set(key, (game = data.game && viewFor(data.game, seat, at)));
      return {
        ...shared,
        side: ('playerId' in viewer && data.seating.sides.get(ctx.keyOf(viewer.playerId))) || null,
        game,
      };
    };
  },
};
