import {
  CHAT_KEPT,
  checkChat,
  checkClue,
  cleanClue,
  clueCounts,
  clueOptions,
  DEADLINE_HERO_MS,
  EVENTS_KEPT,
  EXTENSION_SECONDS,
  otherTeam,
  TEAMS,
  type BoardWord,
  type ClueCount,
  type ClueRecord,
  type EventKind,
  type GameEvent,
  type KeywordsError,
  type KeywordsSettings,
  type Language,
  type Mark,
  type Role,
  type Team,
} from '@reviewer2/shared';
import type { Rng } from '../../core/random';
import { deal } from './deal';
import { guessesLeft, remaining, type Card, type Clock, type KeywordsState } from './state';

// The rules of the game as pure functions: each takes a state and returns the next one, or the
// reason it refuses. docs/games/keywords.md describes them.
//
// Each rule that a player's move goes through checks the move, and then hands it to the function
// that makes it (`apply...`), which checks nothing. The replay of a kept game (replay.ts) makes the
// moves of its log with those alone: the log holds the moves that the rules took, under the rules of
// their time, which may have been other than today's.
//
// Every check runs in the same order: is the action for this game and this turn, is the game
// paused, is it this player's to make, is it the right moment, and only then is its content
// valid. So the answer never depends on the color of a card that the player can't see.
//
// The functions that can start a phase take `at`, the time on the room's clock (GameContext.now),
// from which the phase's time limit counts.

// Who acts: a player, and where they sit.
export interface Actor {
  id: string;
  team: Team | null;
  role: Role;
}

// Which game and which turn an action was meant for. A stale action, such as one that a phone
// sends after it reconnects, must not land in a later turn or a later game.
export interface Moment {
  gameId: string;
  turn: number;
}

export type Outcome = { ok: true; state: KeywordsState } | { ok: false; error: KeywordsError };

const ok = (state: KeywordsState): Outcome => ({ ok: true, state });
const refuse = (error: KeywordsError): Outcome => ({ ok: false, error });

// A new game: its ID, and the room's settings and language, which hold for the whole game.
export interface Setup {
  gameId: string;
  settings: KeywordsSettings;
  language: Language;
}

// The clock of a phase that starts at `at` and is given this many seconds, or none for 0.
const clockFor = (seconds: number, at: number): Clock | null =>
  seconds > 0 ? { ends: at + seconds * 1000, length: seconds * 1000 } : null;

export function newGame(words: readonly (string | BoardWord)[], rng: Rng, setup: Setup, at: number): KeywordsState {
  return beginGame({ ...setup, ...deal(words, rng) }, at);
}

// A game on a board that is dealt already, as it stands when it starts at `at`: the first group's
// PI is to give a clue.
export function beginGame(
  { cards, startingTeam, ...setup }: Setup & { cards: Card[]; startingTeam: Team },
  at: number,
): KeywordsState {
  return {
    ...setup,
    startedAt: at,
    cards,
    startingTeam,
    turn: 1,
    team: startingTeam,
    phase: 'clue',
    clock: clockFor(setup.settings.firstClueTime, at),
    pause: null,
    clue: null,
    guessesMade: 0,
    history: [],
    events: [],
    extended: { red: false, blue: false },
    result: null,
    selections: [],
    marks: { red: [], blue: [] },
    chat: { red: [], blue: [] },
  };
}

function refusal(
  state: KeywordsState,
  moment: Moment,
  actor: Actor,
  role: 'captain' | 'guesser',
): KeywordsError | null {
  if (moment.gameId !== state.gameId || moment.turn !== state.turn) return 'stale';
  if (state.phase === 'over') return 'game_over';
  if (state.pause) return 'paused';
  if (actor.team !== state.team) return 'not_your_turn';
  if (actor.role !== role) return role === 'captain' ? 'not_captain' : 'not_guesser';
  return null;
}

// Notes a pause, a resumption or an extension in the turn it came in. Only the last EVENTS_KEPT
// are kept, so that a chair who pauses and resumes without end can't grow every snapshot.
const noted = (state: KeywordsState, kind: EventKind, team?: Team): KeywordsState => ({
  ...state,
  events: [...state.events, { turn: state.turn, kind, ...(team ? { team } : {}) }].slice(-EVENTS_KEPT),
});

// Whether something that comes at `at` comes in the last seconds of the phase's time limit, where
// the phase has one (docs/games/keywords.md#titles).
const inLastSeconds = (state: KeywordsState, at: number): boolean =>
  state.clock !== null && state.clock.ends - at <= DEADLINE_HERO_MS;

// The deadline heroes of a turn, by player ID (docs/games/keywords.md#titles): every student who
// revealed one of the group's own cards in the last seconds of the guesses, and the PI, if their
// clue came in the last seconds of their time and the students followed it to the letter: they
// found as many of the group's cards as its number says before they revealed anything else, or,
// with fewer cards left than the number, every card the group had left, with no mistake, which wins
// the game in the turn (`won`). A clue of 0 or "unlimited" names no number to follow. Each is a hero
// once a turn, however many cards it took.
export function heroesOf(record: ClueRecord, won = false): Set<string> {
  const own = record.guesses.filter((guess) => guess.color === record.team);
  const heroes = new Set(own.flatMap((guess) => (guess.lastSeconds ? [guess.player] : [])));
  if (record.lastSeconds && record.captain !== undefined && followed(record, won)) heroes.add(record.captain);
  return heroes;
}

// Whether the students followed a clue to the letter: its number of the group's own cards before
// any other, or, with fewer cards left than the number, every card the group had left without a
// mistake, which won the game in the turn. A clue of 0 or "unlimited" names no number to follow.
function followed(record: ClueRecord, won: boolean): boolean {
  const { count, guesses } = record;
  if (typeof count !== 'number' || count === 0) return false;
  const own = (guess: ClueRecord['guesses'][number]) => guess.color === record.team;
  if (guesses.length >= count) return guesses.slice(0, count).every(own);
  return won && guesses.every(own);
}

// Whether a turn of the game won it for the group on turn: the game is over, won by the group that
// found its last card, in that turn.
export const wonInTurn = (game: Pick<KeywordsState, 'history' | 'result'>, record: ClueRecord): boolean =>
  game.result?.winner === record.team && game.result.reason === 'found' && game.history.at(-1) === record;

// The other group's turn, whose time counts from `at`.
export function endTurn(state: KeywordsState, at: number): KeywordsState {
  return {
    ...state,
    team: otherTeam(state.team),
    turn: state.turn + 1,
    phase: 'clue',
    clock: clockFor(state.settings.clueTime, at),
    clue: null,
    guessesMade: 0,
    selections: [],
  };
}

// The end of the game, however it came: the clock stops, and a pause ends with the game, so that
// everyone sees the board with every color (view.ts).
function finish(state: KeywordsState, winner: Team | null, reason: 'found' | 'reviewer2' | 'withdrawn'): KeywordsState {
  return { ...state, phase: 'over', clock: null, pause: null, clue: null, selections: [], result: { winner, reason } };
}

// The cards that a captain marked as the ones their clue is meant for, as the record keeps them, in
// the order they were marked, or null when they won't do: each must be one of the group's own
// cards that is still to be found, and none may come twice. Marking none is fine.
function targetsOf(state: KeywordsState, targets: readonly number[] | undefined): number[] | null {
  if (targets === undefined) return [];
  const own = (card: number) =>
    Number.isInteger(card) && state.cards[card]?.color === state.team && !state.cards[card]?.revealed;
  if (!targets.every(own) || new Set(targets).size !== targets.length) return null;
  return [...targets];
}

// The current team's captain gives a clue: up to as many words as the room allows, and a number
// that the room's guess rule allows, with the cards it is meant for if the captain marked them.
export function giveClue(
  state: KeywordsState,
  actor: Actor,
  action: Moment & { word: string; count: ClueCount; targets?: readonly number[] },
  at: number,
): Outcome {
  const denied = refusal(state, action, actor, 'captain');
  if (denied) return refuse(denied);
  if (state.phase !== 'clue') return refuse('wrong_phase');
  if (!clueCounts(state.settings.guessRule, remaining(state.cards, state.team)).includes(action.count)) {
    return refuse('bad_count');
  }
  const { problem } = checkClue(action.word, state.cards, clueOptions(state.settings, state.language));
  if (problem) return refuse(problem);
  const targets = targetsOf(state, action.targets);
  if (targets === null) return refuse('bad_targets');
  return ok(applyClue(state, actor.id, { word: cleanClue(action.word), count: action.count, targets }, at));
}

// The clue of `captain`, as the record keeps it, with the cards it is meant for, if any: the
// group's students are to guess.
export function applyClue(
  state: KeywordsState,
  captain: string,
  { word, count, targets }: { word: string; count: ClueCount; targets: readonly number[] },
  at: number,
): KeywordsState {
  const record: ClueRecord = {
    turn: state.turn,
    team: state.team,
    word,
    count,
    guesses: [],
    captain,
    at: at - state.startedAt,
    ...(targets.length > 0 ? { targets: [...targets] } : {}),
    ...(inLastSeconds(state, at) ? { lastSeconds: true as const } : {}),
  };
  return {
    ...state,
    phase: 'guess',
    clock: clockFor(state.settings.guessTime, at),
    clue: { word, count },
    guessesMade: 0,
    history: [...state.history, record],
  };
}

// One of the current team's guessers chooses a card without revealing it, or takes the choice
// back with `card: null`. The rest of the group sees the choice, so that they can talk it over
// before anyone reveals anything. Each guesser has one choice at a time. A choice that is made
// already, or a withdrawal of none, gives the state back as it is: nothing has changed.
export function select(state: KeywordsState, actor: Actor, action: Moment & { card: number | null }): Outcome {
  const denied = refusal(state, action, actor, 'guesser');
  if (denied) return refuse(denied);
  if (state.phase !== 'guess') return refuse('wrong_phase');
  if (action.card === null) return ok(dropSelection(state, actor.id));
  const target = Number.isInteger(action.card) ? state.cards[action.card] : undefined;
  if (!target) return refuse('no_such_card');
  if (target.revealed) return refuse('card_revealed');
  const own = state.selections.find((selection) => selection.player === actor.id);
  if (own?.card === action.card) return ok(state);
  const others = state.selections.filter((selection) => selection !== own);
  return ok({ ...state, selections: [...others, { player: actor.id, card: action.card }] });
}

// Whoever leaves their seat or the room takes their choice of a card with them.
export function dropSelection(state: KeywordsState, playerId: string): KeywordsState {
  const others = state.selections.filter((selection) => selection.player !== playerId);
  return others.length === state.selections.length ? state : { ...state, selections: others };
}

// A guesser marks a hidden card for their group (docs/games/keywords.md#talking-it-over): as one of their own
// group's, one of the other group's or maybe Reviewer 2, or clears its mark with null. Unlike a
// choice, a mark may come in either group's turn, while the game is on and not paused, when nobody
// has the board. The mark is the group's: any of its guessers may change it, and the last one
// stands. A mark that is there already, or the clearing of none, gives the state back as it is.
export function mark(
  state: KeywordsState,
  actor: Actor,
  action: Pick<Moment, 'gameId'> & { card: number; mark: Mark | null },
): Outcome {
  if (action.gameId !== state.gameId) return refuse('stale');
  if (state.phase === 'over') return refuse('game_over');
  if (state.pause) return refuse('paused');
  if (actor.team === null || actor.role !== 'guesser') return refuse('not_guesser');
  const target = Number.isInteger(action.card) ? state.cards[action.card] : undefined;
  if (!target) return refuse('no_such_card');
  if (target.revealed) return refuse('card_revealed');
  const marks = state.marks[actor.team];
  if ((marks.find(({ card }) => card === action.card)?.mark ?? null) === action.mark) return ok(state);
  const others = marks.filter(({ card }) => card !== action.card);
  const next = action.mark === null ? others : [...others, { card: action.card, mark: action.mark }];
  return ok({ ...state, marks: { ...state.marks, [actor.team]: next } });
}

// One of the current team's guessers reveals a card. The board has changed then, so everyone's
// choice is cleared, and the guessers choose again if their turn goes on. Neither group's mark
// stays on the card: its color is there for all to see. Whoever the card makes a deadline hero
// (heroesOf) is noted in the events, for the room to hear at once, with how many times they have
// been one now, as `heroes` counts those before, or without, for a player whom nobody counts.
export function reveal(
  state: KeywordsState,
  actor: Actor,
  action: Moment & { card: number },
  at: number,
  heroes: (playerId: string) => number | null = () => null,
): Outcome {
  const denied = refusal(state, action, actor, 'guesser');
  if (denied) return refuse(denied);
  if (state.phase !== 'guess') return refuse('wrong_phase');
  const target = Number.isInteger(action.card) ? state.cards[action.card] : undefined;
  if (!target) return refuse('no_such_card');
  if (target.revealed) return refuse('card_revealed');
  return ok(applyReveal(state, actor.id, action.card, at, heroes));
}

// The card that `player` reveals, which ends the game, the turn or neither.
export function applyReveal(
  state: KeywordsState,
  player: string,
  card: number,
  at: number,
  heroes: (playerId: string) => number | null = () => null,
): KeywordsState {
  const target = state.cards[card] as Card;
  const cards = state.cards.map((each, index) => (index === card ? { ...each, revealed: true } : each));
  const history = state.history.map((record, index) =>
    index === state.history.length - 1
      ? {
          ...record,
          guesses: [
            ...record.guesses,
            {
              card,
              color: target.color,
              player,
              at: at - state.startedAt,
              ...(inLastSeconds(state, at) ? { lastSeconds: true as const } : {}),
            },
          ],
        }
      : record,
  );
  const marks = {
    red: state.marks.red.filter((mark) => mark.card !== card),
    blue: state.marks.blue.filter((mark) => mark.card !== card),
  };
  const before = state.history.at(-1);
  const after = history.at(-1);
  const known = before ? heroesOf(before) : new Set<string>();
  const won = remaining(cards, state.team) === 0;
  const hailed: GameEvent[] = [...(after ? heroesOf(after, won) : [])]
    .filter((player) => !known.has(player))
    .map((player) => {
      const count = heroes(player);
      return {
        turn: state.turn,
        kind: 'hero',
        team: state.team,
        player,
        ...(count !== null ? { count: count + 1 } : {}),
      };
    });
  const next: KeywordsState = {
    ...state,
    cards,
    history,
    guessesMade: state.guessesMade + 1,
    selections: [],
    marks,
    ...(hailed.length > 0 ? { events: [...state.events, ...hailed].slice(-EVENTS_KEPT) } : {}),
  };

  // Reviewer 2 rejects the group that reveals them, whatever else is on the board.
  if (target.color === 'reviewer2') return finish(next, otherTeam(state.team), 'reviewer2');
  // A group wins as soon as all its cards are revealed, even by the other group.
  for (const team of TEAMS) {
    if (remaining(cards, team) === 0) return finish(next, team, 'found');
  }
  if (target.color !== state.team) return endTurn(next, at);
  return guessesLeft(next) === 0 ? endTurn(next, at) : next;
}

// The current team's guessers end their turn, which they may do once they have revealed a card.
export function pass(state: KeywordsState, actor: Actor, action: Moment, at: number): Outcome {
  const denied = refusal(state, action, actor, 'guesser');
  if (denied) return refuse(denied);
  if (state.phase !== 'guess') return refuse('wrong_phase');
  if (state.guessesMade === 0) return refuse('must_guess_first');
  return ok(endTurn(state, at));
}

// The captain whose time for the clue ran out, by player ID, and how many times they had missed the
// deadline before, or null for one without an account, whose misses nobody counts.
export interface Missed {
  captain: string;
  before: number | null;
}

// Ends the phase whose time has run out by `at`, and gives the state back as it is when none has,
// or while the game is paused, when the clock stands still. A captain who gave no clue in time
// loses the turn, which the record notes as a turn without a clue, with the captain whom it costs,
// if any, whom `missed` names; it is asked only then. The events note the missed deadline,
// with how many times the captain has missed one now. Guessers who run out of time end their turn,
// whether or not they have revealed a card, and the record notes that on the turn's clue. Either
// way the other group's turn begins, and its time counts from now. An action meant for the turn
// that ended is stale from then on.
export function expire(state: KeywordsState, at: number, missed: () => Missed | null = () => null): KeywordsState {
  if (state.phase === 'over' || state.pause || !state.clock || at < state.clock.ends) return state;
  return applyTimeout(state, at, missed);
}

// The time of the phase ran out at `at`.
export function applyTimeout(
  state: KeywordsState,
  at: number,
  missed: () => Missed | null = () => null,
): KeywordsState {
  if (state.phase === 'guess') {
    const history = state.history.map((record, index) =>
      index === state.history.length - 1 ? { ...record, timedOut: true as const } : record,
    );
    return endTurn({ ...state, history }, at);
  }
  const blamed = missed();
  const record: ClueRecord = {
    turn: state.turn,
    team: state.team,
    word: null,
    count: null,
    guesses: [],
    timedOut: true,
    ...(blamed ? { captain: blamed.captain } : {}),
    at: at - state.startedAt,
  };
  const history = [...state.history, record];
  if (!blamed) return endTurn({ ...state, history }, at);
  const event: GameEvent = {
    turn: state.turn,
    kind: 'missed',
    team: state.team,
    player: blamed.captain,
    ...(blamed.before !== null ? { count: blamed.before + 1 } : {}),
  };
  return endTurn({ ...state, history, events: [...state.events, event].slice(-EVENTS_KEPT) }, at);
}

// A guesser writes to their group, in either team's turn. Captains can't write: the clue is all
// they may say. Once the game is over, the groups talk it over: whoever played for a group in the
// game, its PI too, may write to it from the seat in it, until the next game, and the message is
// marked as written after the game. `side` is the group that the actor played for in the game, if
// any (Seating.sides); a seat taken after the end makes nobody a player of the game, and so gives
// nobody a say. A message names its game but no turn, because it is welcome in whatever turn it
// arrives. A group keeps its latest messages only.
export function say(
  state: KeywordsState,
  actor: Actor,
  action: Pick<Moment, 'gameId'> & { text: string },
  side: Team | null = null,
): Outcome {
  if (action.gameId !== state.gameId) return refuse('stale');
  const over = state.phase === 'over';
  if (over && (actor.team === null || actor.team !== side)) return refuse('game_over');
  if (!over && (actor.team === null || actor.role !== 'guesser')) return refuse('not_guesser');
  const team = actor.team as Team;
  const { text, problem } = checkChat(action.text);
  if (problem) return refuse(problem);
  const said = state.chat[team];
  const message = {
    id: (said.at(-1)?.id ?? 0) + 1,
    player: actor.id,
    turn: state.turn,
    text,
    ...(over ? { after: true as const } : {}),
  };
  return ok({ ...state, chat: { ...state.chat, [team]: [...said, message].slice(-CHAT_KEPT) } });
}

// The chair ends the game early. Nobody wins. A withdrawal names its game like every other
// action, so that one that arrives late can't end the next game. The turn doesn't matter to it.
export function withdraw(state: KeywordsState, action: Pick<Moment, 'gameId'>): Outcome {
  if (action.gameId !== state.gameId) return refuse('stale');
  if (state.phase === 'over') return refuse('game_over');
  return ok(finish(state, null, 'withdrawn'));
}

// The chair pauses the game, at any point while it is on, and for as long as they like: the
// clock stops with the time the phase has left, every action but the chat is refused, and nobody
// gets the board (view.ts). The pause names its game, as a withdrawal does, and whatever the turn.
export function pause(state: KeywordsState, chair: boolean, action: Pick<Moment, 'gameId'>, at: number): Outcome {
  if (action.gameId !== state.gameId) return refuse('stale');
  if (state.phase === 'over') return refuse('game_over');
  if (!chair) return refuse('not_chair');
  if (state.pause) return refuse('paused');
  return ok(applyPause(state, at));
}

// The clock stops at `at`, with the time the phase has left.
export function applyPause(state: KeywordsState, at: number): KeywordsState {
  const left = state.clock ? Math.max(0, state.clock.ends - at) : null;
  return noted({ ...state, pause: { left } }, 'paused');
}

// The chair, whoever that is by now, resumes the game: the clock goes on from where it stopped.
export function resume(state: KeywordsState, chair: boolean, action: Pick<Moment, 'gameId'>, at: number): Outcome {
  if (action.gameId !== state.gameId) return refuse('stale');
  if (state.phase === 'over') return refuse('game_over');
  if (!chair) return refuse('not_chair');
  if (!state.pause) return refuse('not_paused');
  return ok(applyResume(state, at));
}

// The clock goes on at `at` from where it stopped.
export function applyResume(state: KeywordsState, at: number): KeywordsState {
  const left = state.pause?.left ?? null;
  const clock = state.clock && left !== null ? { ends: at + left, length: state.clock.length } : null;
  return noted({ ...state, clock, pause: null }, 'resumed');
}

// A group asks for its extension: EXTENSION_SECONDS more for the phase it is in, once a game, in
// a room whose settings allow it. The captain asks in the clue phase, a guesser in the guess
// phase. A phase without a time limit has nothing to extend.
export function extend(state: KeywordsState, actor: Actor, action: Moment): Outcome {
  const denied = refusal(state, action, actor, state.phase === 'clue' ? 'captain' : 'guesser');
  if (denied) return refuse(denied);
  if (!state.settings.extensions || !state.clock) return refuse('no_extension');
  if (state.extended[state.team]) return refuse('extension_used');
  return ok(applyExtension(state));
}

// The group on turn has its extension: EXTENSION_SECONDS more for the phase.
export function applyExtension(state: KeywordsState): KeywordsState {
  const more = EXTENSION_SECONDS * 1000;
  const clock = state.clock && { ends: state.clock.ends + more, length: state.clock.length + more };
  return noted({ ...state, clock, extended: { ...state.extended, [state.team]: true } }, 'extended', state.team);
}
