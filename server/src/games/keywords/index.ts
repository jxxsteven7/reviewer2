import {
  BOARD_SIZE,
  cardsClash,
  defaultSettings,
  otherTeam,
  sameSettings,
  settingsProblems,
  SPECTATOR,
  TEAMS,
  verdictFor,
  type KeywordsReplay,
  type KeywordsRoomData,
  type KeywordsSettings,
  type KeywordsView,
  type Seat,
  type Team,
} from '@reviewer2/shared';
import { KEYWORDS_MESSAGES, KEYWORDS_SETTINGS, type KeywordsMessage } from '@reviewer2/shared/schemas';
import type { z } from 'zod';
import { fail } from '../../core/answers';
import type { GameContext, GameModule, GameUpdate } from '../../core/game';
import {
  dropSelection,
  expire,
  extend,
  giveClue,
  newGame,
  pass,
  pause,
  resume,
  reveal,
  say,
  select,
  withdraw,
  type Actor,
  type Outcome,
} from './rules';
import {
  afterScoredGame,
  arrangeFixed,
  counts,
  drawProblems,
  lineupOf,
  newMatchSeating,
  rekeyMatch,
  rekeySeating,
  scoreGame,
  type MatchSeating,
} from './match';
import {
  autoSeat,
  changeSeat,
  emptySeating,
  endGame,
  removeSeat,
  seatOf,
  shuffleGroups,
  startGame,
  startProblems,
  type GameStage,
  type Member,
  type Seating,
  type SeatRequest,
} from './seats';
import { copyRecord, remaining, type KeywordsState } from './state';
import { viewFor } from './view';

// The team word guessing game as a GameModule: the rules in rules.ts and seats.ts, connected to
// a room. docs/games/keywords.md describes the game.

export interface KeywordsData {
  // The room's settings. A game takes them along when it starts.
  settings: KeywordsSettings;
  seating: Seating;
  game: KeywordsState | null;
  // The game's part of the match that the room plays, if it plays one (match.ts).
  match: MatchSeating | null;
}

const online = (ctx: GameContext) => new Set(ctx.playerIds().filter((id) => ctx.isOnline(id)));

const membersOf = (ctx: GameContext) => ctx.playerIds().map((id) => ({ id, key: ctx.keyOf(id) }));

// What keeps the next game from starting: with groups that the server draws, too few players;
// otherwise a missing PI or student in a group.
const problemsOf = (data: KeywordsData, ctx: GameContext) =>
  lineupOf(data.match) === 'draw' ? drawProblems(data.seating, online(ctx)) : startProblems(data.seating, online(ctx));

// The rules give the state back as it is when an action changed nothing, and then so does the
// module: the room sends no snapshot for that.
const fromOutcome = (data: KeywordsData, outcome: Outcome): GameUpdate<KeywordsData> => {
  if (!outcome.ok) return outcome;
  return { ok: true, data: outcome.state === data.game ? data : { ...data, game: outcome.state } };
};

const withoutSelection = (game: KeywordsState | null, playerId: string) => game && dropSelection(game, playerId);

// How far the current game has got, for the seat rules (seats.ts). They hold from the start of a
// game until "play again" takes the room back to the waiting room: `data.game` is there for
// exactly that long. The room's phase would let go of them as soon as the game has ended, while
// the groups still have their chats.
function stageOf(data: KeywordsData): GameStage {
  if (data.game === null) return 'none';
  return data.game.phase === 'over' ? 'over' : 'on';
}

// Moves a player to the seat they ask for, or to the spectators when the chair benches them.
// Whoever leaves their seat takes their choice of a card with them (rules.ts); whoever asks for
// the seat they are in changes nothing.
//
// A match adds its own rules (matchRefusal). While one of its games is on, only those who have
// played for a group in it may sit in one: anyone else plays from the next game. Once its groups
// are fixed, everyone who has played for one sits in it alone, and a newcomer joins the group with
// fewer players. Whoever was to play from the next game and asks to watch changes their mind.
function sit(data: KeywordsData, ctx: GameContext, playerId: string, wanted: SeatRequest): GameUpdate<KeywordsData> {
  const member = { id: playerId, key: ctx.keyOf(playerId) };
  const refusal = data.match && matchRefusal(data, data.match, member, wanted);
  if (refusal) return { ok: false, error: refusal };
  const change = changeSeat(data.seating, member, wanted, stageOf(data));
  if (!change.ok) return change;
  let { match } = data;
  if (match?.waiting.has(member.key) && wanted.role === 'spectator') {
    match = { ...match, waiting: new Set([...match.waiting].filter((other) => other !== member.key)) };
  }
  if (change.seating === data.seating && match === data.match) return { ok: true, data };
  return {
    ok: true,
    data: { ...data, seating: change.seating, game: withoutSelection(data.game, playerId), match },
  };
}

function matchRefusal(data: KeywordsData, match: MatchSeating, member: Member, wanted: SeatRequest) {
  if (wanted.team === null) return null;
  const stage = stageOf(data);
  if (stage === 'on') return data.seating.sides.has(member.key) ? null : 'between_games';
  if (lineupOf(match) !== 'fixed') return null;
  const team = match.locked.get(member.key);
  if (team !== undefined) return team === wanted.team ? null : 'other_team';
  return biggerGroup(data.seating, member.id, wanted.team) ? 'bigger_group' : null;
}

// Whether a group has more players in its seats than the other, not counting the player who asks,
// who may sit in one of them already. A newcomer to a match whose groups are fixed joins the group
// with fewer players, or either when both have as many, so that the groups stay as even as they can
// be; the chair's shuffle has nothing to do there.
function biggerGroup(seating: Seating, playerId: string, team: Team): boolean {
  const size = (group: Team) =>
    [...seating.seats].filter(([id, seat]) => id !== playerId && seat.team === group).length;
  return size(team) > size(otherTeam(team));
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
  // Only the chair pauses and resumes, whoever that is by now: the room passes the chair on after
  // a while when the chair is offline.
  'keywords:pause': (data, ctx, playerId, moment) =>
    act(data, playerId, (game) => pause(game, playerId === ctx.chairId, moment, ctx.now())),
  'keywords:resume': (data, ctx, playerId, moment) =>
    act(data, playerId, (game) => resume(game, playerId === ctx.chairId, moment, ctx.now())),
  'keywords:extend': (data, _ctx, playerId, moment) =>
    act(data, playerId, (game, actor) => extend(game, actor, moment)),
};

export const keywordsGame: GameModule<KeywordsData, KeywordsRoomData> = {
  id: 'keywords',
  wordsNeeded: BOARD_SIZE,
  // Two words of which one lies inside the other would give each other away: "Gene" and "Gene
  // editing" can't share a board.
  wordsClash: cardsClash,

  create: (language) => ({ settings: defaultSettings(language), seating: emptySeating(), game: null, match: null }),

  // The settings come whole, and must suit the room's language: a Chinese room counts the clue's
  // characters, an English room its words.
  configure(data, ctx, settings) {
    const parsed = KEYWORDS_SETTINGS.safeParse(settings);
    if (!parsed.success || Object.keys(settingsProblems(parsed.data, ctx.language)).length > 0) {
      return fail('bad_settings');
    }
    return { ok: true, data: sameSettings(parsed.data, data.settings) ? data : { ...data, settings: parsed.data } };
  },

  // A newcomer who has come to play becomes a guesser in a group (seats.ts); anyone else watches
  // until they take a seat.
  // In a match, a newcomer who comes while a game is on watches it, and plays from the next one; with
  // fixed groups, whoever has played for a group goes back to it.
  join(data, ctx, playerId, play) {
    if (!play) return data;
    const member = { id: playerId, key: ctx.keyOf(playerId) };
    const { match } = data;
    if (match && stageOf(data) === 'on' && !data.seating.sides.has(member.key)) {
      return { ...data, match: { ...match, waiting: new Set(match.waiting).add(member.key) } };
    }
    const preferred = match?.locked.get(member.key);
    const seating = autoSeat(data.seating, member, ctx.rng, stageOf(data), preferred);
    return seating === data.seating ? data : { ...data, seating };
  },

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

  // A match whose groups are fixed, or drawn when its game starts, has nothing for the chair to
  // shuffle.
  shuffle: (data, ctx) =>
    lineupOf(data.match) === 'free' ? { ...data, seating: shuffleGroups(data.seating, ctx.rng, online(ctx)) } : data,

  canStart: (data, ctx) => problemsOf(data, ctx).length === 0,

  // A match's game whose groups are drawn deals everyone who plays into the groups as the chair's
  // shuffle does, and starts with those groups.
  start(data, ctx, words, gameId) {
    const seating = lineupOf(data.match) === 'draw' ? shuffleGroups(data.seating, ctx.rng, online(ctx)) : data.seating;
    return {
      ...data,
      seating: startGame(seating, ctx.keyOf),
      game: newGame(words, ctx.rng, { gameId, settings: data.settings, language: ctx.language }, ctx.now()),
    };
  },

  // A game that is over has no clock, and a paused one has nothing due until it resumes.
  deadline: (data) => (data.game?.pause ? null : (data.game?.clock?.ends ?? null)),

  tick(data, ctx) {
    if (!data.game) return data;
    const game = expire(data.game, ctx.now());
    return game === data.game ? data : { ...data, game };
  },

  isOver: (data) => data.game?.phase === 'over',

  withdraw: (data, gameId) => (data.game ? fromOutcome(data, withdraw(data.game, { gameId })) : fail('stale')),

  // In a match, a scored game counts for the PIs' turns and fixes the groups, if they are to be
  // fixed; then whoever came to play during the game sits down, and with fixed groups, everyone is
  // seated in their group with the next PI (match.ts).
  again(data, ctx) {
    const seating = endGame(data.seating);
    if (!data.match) return { ...data, seating, game: null };
    const scored = data.game !== null && counts(data.game);
    let match = scored ? afterScoredGame(data.match, data.seating) : data.match;
    const members = membersOf(ctx);
    let next = seating;
    for (const member of members) {
      if (match.waiting.has(member.key)) next = autoSeat(next, member, ctx.rng, 'none', match.locked.get(member.key));
    }
    match = { ...match, waiting: new Set() };
    if (scored && lineupOf(match) === 'fixed') next = arrangeFixed(next, members, match, online(ctx), ctx.rng);
    return { ...data, seating: next, game: null, match };
  },

  // The seat stands, and in a match whose groups are fixed, so does its group (match.ts).
  rekey(data, playerId, from, to) {
    const seating = rekeySeating(data.seating, from, to);
    if (!data.match) return { ...data, seating };
    const team = seating.sides.get(to) ?? seatOf(seating, playerId).team ?? undefined;
    return { ...data, seating, match: rekeyMatch(data.match, from, to, team) };
  },

  match: {
    setup: (data, _ctx, rules) => ({ ...data, match: rules && newMatchSeating(rules) }),
    score: (data, ctx) => (data.game ? scoreGame(data.game, data.seating.sides, ctx.keyOf) : null),
    lineup: (data) => [...data.seating.seats].filter(([, seat]) => seat.team !== null).map(([id]) => id),
  },

  handle(data, ctx, playerId, type, payload) {
    if (!Object.hasOwn(KEYWORDS_MESSAGES, type)) return fail('bad_request');
    const message = type as KeywordsMessage;
    const parsed = KEYWORDS_MESSAGES[message].safeParse(payload ?? {});
    if (!parsed.success) return fail('bad_request');
    // The schema and the action of one message go together, which the types can't see across a
    // lookup by name, as in socket.ts.
    return (actions[message] as Action<KeywordsMessage>)(data, ctx, playerId, parsed.data);
  },

  // A game that was withdrawn counts for no record. Everyone in a seat when it ended took part: the
  // captain as the group's PI and the guessers as its students. The verdict is the decision letter
  // that their group got.
  results(data) {
    const result = data.game?.result;
    if (!data.game || !result || result.winner === null) return null;
    const left = Object.fromEntries(TEAMS.map((team) => [team, remaining(data.game?.cards ?? [], team)])) as Record<
      Team,
      number
    >;
    const { winner } = result;
    return [...data.seating.seats].flatMap(([playerId, seat]) =>
      seat.team === null
        ? []
        : [
            {
              playerId,
              side: seat.team,
              role: seat.role,
              winner,
              won: seat.team === winner,
              verdict: verdictFor(result, left, seat.team),
            },
          ],
    );
  },

  // The game that has just ended, to watch again (shared/src/games/keywords/replay.ts): the whole
  // board with its colors, the record of the clues and the guesses, and the name that everyone who
  // revealed a card had. A withdrawn game is nothing to watch.
  replay(data, ctx): KeywordsReplay | null {
    const game = data.game;
    if (!game?.result || game.result.winner === null) return null;
    const players: Record<string, string> = {};
    for (const record of game.history) {
      for (const { player } of record.guesses) players[player] ??= ctx.nameOf(player);
    }
    return {
      gameId: game.gameId,
      language: game.language,
      startingTeam: game.startingTeam,
      cards: game.cards.map(({ word, color }) => ({ word, color })),
      history: game.history.map(copyRecord),
      result: { ...game.result },
      players,
    };
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
      startProblems: ctx.phase === 'lobby' ? problemsOf(data, ctx) : [],
      lineup: lineupOf(data.match),
    };
    // What a viewer sees of the game depends on the seat they are in right now (view.ts): a
    // captain who has stepped down to watch gets a spectator's view, and a screen always does.
    // So there are at most five views of a game, one for each seat, and each is built once.
    const boards = new Map<string, KeywordsView | null>();
    return (viewer) => {
      const seat = ('playerId' in viewer && seats[viewer.playerId]) || SPECTATOR;
      const board = `${seat.team}:${seat.role}`;
      let game = boards.get(board);
      if (game === undefined) boards.set(board, (game = data.game && viewFor(data.game, seat, at)));
      const key = 'playerId' in viewer ? ctx.keyOf(viewer.playerId) : null;
      // In the waiting room of a match whose groups are fixed, the group is the one the player is
      // fixed to; during and after a game, the one they played for in it, if any.
      const fixed = stageOf(data) === 'none' && key !== null ? data.match?.locked.get(key) : undefined;
      return {
        ...shared,
        side: (key !== null && (data.seating.sides.get(key) ?? fixed)) || null,
        joinsNext: key !== null && (data.match?.waiting.has(key) ?? false),
        game,
      };
    };
  },
};
