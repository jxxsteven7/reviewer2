import {
  BOARD_SIZE,
  cardsClash,
  checkChat,
  cleanClue,
  defaultSettings,
  otherTeam,
  sameSettings,
  settingsProblems,
  SPECTATOR,
  TEAMS,
  type KeywordsRoomData,
  type KeywordsSettings,
  type KeywordsView,
  type Seat,
  type Team,
  type Title,
  type TitleCount,
} from '@reviewer2/shared';
import { KEYWORDS_MESSAGES, KEYWORDS_SETTINGS, type KeywordsMessage } from '@reviewer2/shared/schemas';
import type { z } from 'zod';
import { fail } from '../../core/answers';
import { recountOf, shownReplay, type KeywordsSetup } from './replay';
import { resultsOf, titlesOf } from './results';
import {
  agentLimitReached,
  agentMove,
  agentProblems,
  agentSeat,
  agentTask,
  personSeated,
  practiceSeats,
} from './agents';
import type {
  AgentFeats,
  GameContext,
  GameLogNote,
  GameModule,
  GameShapes,
  GameUpdate,
  LogNote,
} from '../../core/game';
import {
  dropSelection,
  expire,
  extend,
  giveClue,
  heroesOf,
  mark,
  newGame,
  pass,
  pause,
  resume,
  reveal,
  say,
  select,
  withdraw,
  type Actor,
  type Missed,
  type Outcome,
} from './rules';
import {
  afterScoredGame,
  arrangeFixed,
  counts,
  drawGroups,
  drawProblems,
  lineupOf,
  missedDeadline,
  newMatchSeating,
  rekeyMatch,
  rekeySeating,
  scoreGame,
  type MatchSeating,
} from './match';
import {
  autoSeat,
  captainOf,
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
import type { KeywordsState } from './state';
import { viewFor } from './view';

// The team word guessing game as a GameModule: the rules in rules.ts and seats.ts, connected to
// a room. docs/games/keywords.md describes the game.

export interface KeywordsData {
  // The room's settings. A game takes them along when it starts.
  settings: KeywordsSettings;
  seating: Seating;
  game: KeywordsState | null;
  // Whoever has left each group's PI seat of their own accord while the game is on, by player ID,
  // stepping down or leaving the room: a deadline that the group misses while its seat stays empty
  // costs them (missedBy), as it would in the seat, so that stepping down before the deadline and
  // taking the seat back afterwards saves nothing. A PI whom the chair benched isn't noted (bench).
  vacated: Record<Team, string | null>;
  // The game's part of the match that the room plays, if it plays one (match.ts).
  match: MatchSeating | null;
}

const nobodyVacated = (): Record<Team, string | null> => ({ red: null, blue: null });

const online = (ctx: GameContext) => new Set(ctx.playerIds().filter((id) => ctx.isOnline(id)));

const membersOf = (ctx: GameContext) => ctx.playerIds().map((id) => ({ id, key: ctx.keyOf(id) }));

// What keeps the next game from starting: with groups that the server draws, too few players;
// otherwise a missing PI or student in a group; and with AI players, what they need (agents.ts).
const problemsOf = (data: KeywordsData, ctx: GameContext) => [
  ...(lineupOf(data.match) === 'draw'
    ? drawProblems(data.seating, online(ctx))
    : startProblems(data.seating, online(ctx))),
  ...agentProblems(data, ctx),
];

// The AI players, whose seats the chair's shuffle leaves as they are.
const agentsOf = (ctx: GameContext) => new Set(ctx.playerIds().filter((id) => ctx.agentOf(id) !== null));

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
    data: {
      ...data,
      seating: change.seating,
      game: withoutSelection(data.game, playerId),
      vacated: vacatedBy(data, playerId, change.seating),
      match,
    },
  };
}

// What the game remembers of who has left a PI seat (KeywordsData.vacated) once `after` is the
// seating: the player, if they held a group's PI seat while the game is on and hold it no more.
function vacatedBy(data: KeywordsData, playerId: string, after: Seating): KeywordsData['vacated'] {
  const { team, role } = seatOf(data.seating, playerId);
  if (stageOf(data) !== 'on' || role !== 'captain' || team === null) return data.vacated;
  return captainOf(after, team) === playerId ? data.vacated : { ...data.vacated, [team]: playerId };
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

// What the log of the game keeps of each of its messages (docs/architecture.md#game-records): what
// it carried, as its schema reads it, without the game's ID, which is the log's own, and with the
// clue's word as the record keeps it (cleanClue). A line of a group's chat is what the player said,
// as the chat shows it (checkChat), which the log keeps apart. Nothing is kept of a card chosen:
// students choose and choose again before they reveal one, for the fun of it as much as anything.
// Nor of each mark, which a group sets and changes as it talks: the log keeps how a group's marks
// stood when it acted instead (markNotes).
function logNote(type: string, payload: unknown): LogNote | null {
  if (!Object.hasOwn(KEYWORDS_MESSAGES, type) || type === 'keywords:select' || type === 'keywords:mark') return null;
  const parsed = KEYWORDS_MESSAGES[type as KeywordsMessage].safeParse(payload ?? {});
  if (!parsed.success) return null;
  const data: Record<string, unknown> = { ...parsed.data };
  delete data.gameId;
  if (type === 'keywords:say') return { said: checkChat(data.text as string).text };
  if (type === 'keywords:clue') data.word = cleanClue(data.word as string);
  return Object.keys(data).length > 0 ? { data } : {};
}

// The marks of a group, as the log keeps them (docs/architecture.md#game-records): those of the
// group that reveals a card, as they stood when it did, and those of both groups when a turn or the
// game ends. A group without marks has nothing to note.
const guessesIn = (game: KeywordsState) => game.history.reduce((count, record) => count + record.guesses.length, 0);
const marksOf = (game: KeywordsState, team: Team): GameLogNote[] =>
  game.marks[team].length > 0
    ? [{ type: 'keywords:marks', data: { team, marks: game.marks[team].map((entry) => ({ ...entry })) } }]
    : [];

function markNotes(before: KeywordsData, after: KeywordsData): GameLogNote[] {
  const was = before.game;
  const now = after.game;
  if (!was || !now || was.gameId !== now.gameId) return [];
  const notes = guessesIn(now) > guessesIn(was) ? marksOf(was, was.team) : [];
  if (now.turn !== was.turn || (now.phase === 'over' && was.phase !== 'over')) {
    for (const team of TEAMS) notes.push(...marksOf(now, team));
  }
  return notes;
}

// A PI, of either group, sends no quick reaction while a group's students are guessing, paused or
// not, and neither does anyone who has been a PI in this game and has stepped out to watch: they
// have seen every color, and a reaction then could tell the students which card to reveal
// (docs/games/keywords.md#quick-reactions). Who has seen the key is kept by member key (seats.ts),
// so that leaving the room and coming back changes nothing.
const mayEmote = (data: KeywordsData, playerId: string, ctx: Pick<GameContext, 'keyOf'>) =>
  data.game?.phase !== 'guess' ||
  (seatOf(data.seating, playerId).role !== 'captain' && !data.seating.keyViewers.has(ctx.keyOf(playerId)));

// The version of the rules and the scoring (GameModule.rulesVersion). Raise it by one with every
// change to either; the records of every kept game are then counted again under the new version
// (store/recount.ts). Version 2 brought the students' marks, the homophone rule of a Chinese room
// and the hold on the quick reactions of whoever has seen the key while the students guess; version
// 3 the numbers, the English and the pinyin of a character as the same character in the clue check,
// and the groups' talk after the game, the PI's included; version 4 the 5 points that a PI loses
// for each missed deadline, and boards on which no row or column is all one group's cards; version
// 5 the opening record from a first clue of 4 or more, which brings the PI no point and which the
// heavenly hand outdoes, the instant desk reject and the fall at the first hurdle, the PI's deadline
// hero for a clue followed to the letter, and no clue that a Latin word on the board starts with.
export const RULES_VERSION = 5;

const actions: { [M in KeywordsMessage]: Action<M> } = {
  'keywords:seat': (data, ctx, playerId, seat) => sit(data, ctx, playerId, seat),
  'keywords:clue': (data, ctx, playerId, clue) =>
    act(data, playerId, (game, actor) => giveClue(game, actor, clue, ctx.now())),
  'keywords:select': (data, _ctx, playerId, choice) =>
    act(data, playerId, (game, actor) => select(game, actor, choice)),
  'keywords:mark': (data, _ctx, playerId, marking) => act(data, playerId, (game, actor) => mark(game, actor, marking)),
  'keywords:reveal': (data, ctx, playerId, guess) =>
    act(data, playerId, (game, actor) => reveal(game, actor, guess, ctx.now(), (hero) => heroBefore(game, ctx, hero))),
  'keywords:pass': (data, ctx, playerId, moment) =>
    act(data, playerId, (game, actor) => pass(game, actor, moment, ctx.now())),
  // After the game, whoever played for a group may talk it over with it (rules.ts).
  'keywords:say': (data, ctx, playerId, line) =>
    act(data, playerId, (game, actor) => say(game, actor, line, data.seating.sides.get(ctx.keyOf(playerId)) ?? null)),
  // Only the chair pauses and resumes, whoever that is by now: the room passes the chair on after
  // a while when the chair is offline.
  'keywords:pause': (data, ctx, playerId, moment) =>
    act(data, playerId, (game) => pause(game, playerId === ctx.chairId, moment, ctx.now())),
  'keywords:resume': (data, ctx, playerId, moment) =>
    act(data, playerId, (game) => resume(game, playerId === ctx.chairId, moment, ctx.now())),
  'keywords:extend': (data, _ctx, playerId, moment) =>
    act(data, playerId, (game, actor) => extend(game, actor, moment)),
};

// The captain in the seat of the group whose time for the clue has run out, or, when the seat is
// empty, the one who left it during the game (KeywordsData.vacated), and how many times they had
// missed the deadline before: as their account's titles count it, and in this game so far, whose
// titles are awarded only at its end. A guest's misses go uncounted, and so does everyone's in a
// game that awards no titles, as one with AI players (GameContext.titleCount).
function missedBy(data: KeywordsData, ctx: GameContext): Missed | null {
  const game = data.game;
  if (!game) return null;
  const captain = captainOf(data.seating, game.team) ?? data.vacated[game.team];
  if (captain === null) return null;
  const held = ctx.titleCount(captain, 'missed_deadline');
  if (held === null) return { captain, before: null };
  const key = ctx.keyOf(captain);
  const earlier = game.history.filter((record) => missedDeadline(record) && ctx.keyOf(record.captain ?? '') === key);
  return { captain, before: held + earlier.length };
}

// How many times a player had been a deadline hero before the card that makes them one now: as
// their account's titles count it, and in this game so far, whose titles are awarded only at its
// end. Null for a guest, and for everyone in a game that awards no titles (GameContext.titleCount).
function heroBefore(game: KeywordsState, ctx: GameContext, playerId: string): number | null {
  const held = ctx.titleCount(playerId, 'deadline_hero');
  if (held === null) return null;
  const key = ctx.keyOf(playerId);
  return held + game.history.filter((record) => [...heroesOf(record)].some((hero) => ctx.keyOf(hero) === key)).length;
}

// The titles that the game so far has brought each player whom its titles go to, by player ID,
// each with how many times it came, for the view (KeywordsRoomData.titles): once the game is over,
// those that results() awards, so none for a game that the chair withdrew, which awards none.
function titlesSoFar(data: KeywordsData, ctx: GameContext): Record<string, TitleCount[]> {
  const game = data.game;
  const earned: Record<string, TitleCount[]> = {};
  if (!game || !counts(game)) return earned;
  for (const [playerId, seat] of data.seating.seats) {
    if (seat.team === null || !ctx.awardsTitles(playerId)) continue;
    const tally = new Map<Title, number>();
    for (const { title } of titlesOf(game, seat.team, ctx.keyOf(playerId), ctx.keyOf)) {
      tally.set(title, (tally.get(title) ?? 0) + 1);
    }
    if (tally.size > 0) earned[playerId] = [...tally].map(([title, count]) => ({ title, count }));
  }
  return earned;
}

// The shapes of the game's own in its data, for the check of the data (GameModule.shapes): how a
// game began (setup), the settings as a room setup keeps them, the roles that its records name,
// and what it counts of an AI player in a seat (agentFeats).
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const COLORS: readonly string[] = [...TEAMS, 'neutral', 'reviewer2'];
const shapes: GameShapes = {
  setup: (value) =>
    isObject(value) &&
    KEYWORDS_SETTINGS.strict().safeParse(value.settings).success &&
    TEAMS.includes(value.startingTeam as Team) &&
    Array.isArray(value.cards) &&
    value.cards.length === BOARD_SIZE &&
    value.cards.every(
      (card) =>
        isObject(card) &&
        typeof card.word === 'string' &&
        COLORS.includes(card.color as string) &&
        typeof card.custom === 'boolean' &&
        Object.keys(card).length === 3,
    ) &&
    Object.keys(value).length === 3,
  settings: (value) => KEYWORDS_SETTINGS.strict().safeParse(value).success,
  role: (role) => role === 'captain' || role === 'guesser',
  feats: (value) =>
    isObject(value) &&
    Number.isInteger(value.clues) &&
    Number.isInteger(value.found) &&
    Number.isInteger(value.reviewer2) &&
    (value.best === null ||
      (isObject(value.best) && typeof value.best.word === 'string' && Number.isInteger(value.best.found))) &&
    Object.keys(value).length === 4,
};

export const keywordsGame: GameModule<KeywordsData, KeywordsRoomData> = {
  id: 'keywords',
  rulesVersion: RULES_VERSION,
  wordsNeeded: BOARD_SIZE,
  // Two words of which one lies inside the other would give each other away: "Gene" and "Gene
  // editing" can't share a board.
  wordsClash: cardsClash,

  create: (language) => ({
    settings: defaultSettings(language),
    seating: emptySeating(),
    game: null,
    vacated: nobodyVacated(),
    match: null,
  }),

  // The settings come whole, and must suit the room's language: a Chinese room counts the clue's
  // characters, an English room its words.
  configure(data, ctx, settings) {
    const parsed = KEYWORDS_SETTINGS.safeParse(settings);
    if (!parsed.success || Object.keys(settingsProblems(parsed.data, ctx.language)).length > 0) {
      return fail('bad_settings');
    }
    return { ok: true, data: sameSettings(parsed.data, data.settings) ? data : { ...data, settings: parsed.data } };
  },

  settingsOf: (data) => data.settings,

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

  // A captain who leaves frees the seat; the key viewers remember them anyway, the groups remember
  // whom each player has played for, and a deadline missed while the seat stays empty costs them.
  leave(data, playerId) {
    const seating = removeSeat(data.seating, playerId);
    return {
      ...data,
      seating,
      game: withoutSelection(data.game, playerId),
      vacated: vacatedBy(data, playerId, seating),
    };
  },

  // A PI whom the chair benches didn't choose to leave the seat, so a deadline missed while it
  // stays empty costs them nothing; the chair benching themselves is stepping down.
  bench(data, ctx, playerId) {
    const seated = sit(data, ctx, playerId, SPECTATOR);
    if (!seated.ok || seated.data === data) return data;
    return playerId === ctx.chairId ? seated.data : { ...seated.data, vacated: data.vacated };
  },

  // A match whose groups are fixed, or drawn when its game starts, has nothing for the chair to
  // shuffle.
  shuffle: (data, ctx) =>
    lineupOf(data.match) === 'free'
      ? { ...data, seating: shuffleGroups(data.seating, ctx.rng, online(ctx), agentsOf(ctx)) }
      : data,

  canStart: (data, ctx) => problemsOf(data, ctx).length === 0,

  // A match's game whose groups are drawn deals everyone who plays into the groups, apart from
  // those who have played together, with the PIs taking turns (match.ts), and starts with those
  // groups.
  start(data, ctx, words, gameId) {
    const seating =
      data.match && lineupOf(data.match) === 'draw'
        ? drawGroups(data.seating, membersOf(ctx), data.match, online(ctx), ctx.rng)
        : data.seating;
    return {
      ...data,
      seating: startGame(seating, ctx.keyOf),
      game: newGame(words, ctx.rng, { gameId, settings: data.settings, language: ctx.language }, ctx.now()),
      vacated: nobodyVacated(),
    };
  },

  // A game that is over has no clock, and a paused one has nothing due until it resumes.
  deadline: (data) => (data.game?.pause ? null : (data.game?.clock?.ends ?? null)),

  // A captain whose time for the clue runs out is named, with how many times they have missed the
  // deadline (missedBy).
  tick(data, ctx) {
    if (!data.game) return data;
    const game = expire(data.game, ctx.now(), () => missedBy(data, ctx));
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

  // An AI player sits as a group's PI or as one of its students, in the waiting room, once a person
  // sits in a group; a match has none (Room.startMatch). A group has one AI PI and one AI student at
  // most.
  seatAgent(data, ctx, playerId, seat) {
    const wanted = agentSeat(seat);
    if (!wanted) return { ok: false, error: 'bad_seat' };
    if (!personSeated(data.seating, ctx)) return { ok: false, error: 'needs_human' };
    if (agentLimitReached(data.seating, ctx, playerId, wanted.team, wanted.role)) {
      return { ok: false, error: 'agent_limit' };
    }
    return sit(data, ctx, playerId, wanted);
  },

  practice: practiceSeats,
  agentTask,
  agentMove: (data, _ctx, playerId, task, answer, made) => agentMove(data, playerId, task, answer, made),

  // Where a member is: the group and the role of the seat they are in, or the spectators'.
  seated(data, playerId) {
    const { team, role } = seatOf(data.seating, playerId);
    return { team, role };
  },

  // How the game began: the settings, the group that starts, and the board, every card's color
  // included and each card marked as a word of the chair's own or of the lists. It goes into the
  // record of the game alone, which stays on the server, with the room's language beside it.
  setup(data): KeywordsSetup | null {
    const game = data.game;
    if (!game) return null;
    return {
      settings: { ...game.settings },
      startingTeam: game.startingTeam,
      cards: game.cards.map(({ word, color, custom }) => ({ word, color, custom: custom === true })),
    };
  },

  shapes,

  logged: logNote,
  logChanges: markNotes,
  mayEmote,

  // How the game came out, for its record: the group that won, and whether it found every card of
  // its own or the other group revealed Reviewer 2.
  outcome(data) {
    const result = data.game?.result;
    return result && result.winner !== null ? { winner: result.winner, reason: result.reason } : null;
  },

  // What an AI player did: the clues it gave as its group's PI, with how many of the group's cards
  // were found in each of their turns, the clue that found the most, and how often it revealed
  // Reviewer 2 as a student.
  agentFeats(data, playerId) {
    const feats: AgentFeats = { clues: 0, found: 0, reviewer2: 0, best: null };
    for (const record of data.game?.history ?? []) {
      if (record.captain === playerId && record.word !== null) {
        const found = record.guesses.filter(({ color }) => color === record.team).length;
        feats.clues += 1;
        feats.found += found;
        if (found > 0 && (feats.best === null || found > feats.best.found)) feats.best = { word: record.word, found };
      }
      feats.reviewer2 += record.guesses.filter(
        ({ player, color }) => player === playerId && color === 'reviewer2',
      ).length;
    }
    return feats;
  },

  // Whom the game is waiting for: the PI of the group on turn while its clue is due, and its
  // students while they guess. Nobody while the game is paused or over.
  due(data) {
    const game = data.game;
    if (!game || game.phase === 'over' || game.pause) return [];
    const role = game.phase === 'clue' ? 'captain' : 'guesser';
    return [...data.seating.seats]
      .filter(([, seat]) => seat.team === game.team && seat.role === role)
      .map(([id]) => id);
  },

  // Everyone who has sat in a group during the game has played in it, whether or not they are
  // still there.
  participants: (data) => [...data.seating.sides.keys()],

  match: {
    setup: (data, _ctx, rules) => ({ ...data, match: rules && newMatchSeating(rules) }),
    score: (data, ctx) => (data.game ? scoreGame(data.game, data.seating, ctx.keyOf) : null),
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

  // A game that was withdrawn counts for no record (results.ts).
  results(data, ctx) {
    const game = data.game;
    if (!game?.result || game.result.winner === null) return null;
    return resultsOf(game, data.seating, ctx.keyOf);
  },

  // A kept game as an account watches it again, and counted again under the rules of today
  // (replay.ts).
  showReplay: shownReplay,
  recount: recountOf,

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
      titles: titlesSoFar(data, ctx),
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
        mayEmote: !('playerId' in viewer) || mayEmote(data, viewer.playerId, ctx),
        game,
      };
    };
  },
};
