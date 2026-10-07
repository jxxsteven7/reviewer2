import {
  CHAT_KEPT,
  checkChat,
  checkClue,
  cleanClue,
  isClueCount,
  otherTeam,
  TEAMS,
  type BoardWord,
  type ClueCount,
  type KeywordsError,
  type Role,
  type Team,
} from '@reviewer2/shared';
import type { Rng } from '../../core/random';
import { deal } from './deal';
import { guessesLeft, remaining, type KeywordsState } from './state';

// The rules of the game as pure functions: each takes a state and returns the next one, or the
// reason it refuses. docs/games/keywords.md describes them.
//
// Every check runs in the same order: is the action for this game and this turn, is it this
// player's to make, is it the right moment, and only then is its content valid. So the answer
// never depends on the color of a card that the player can't see.

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

export function newGame(words: readonly (string | BoardWord)[], rng: Rng, gameId: string): KeywordsState {
  const { cards, startingTeam } = deal(words, rng);
  return {
    gameId,
    cards,
    startingTeam,
    turn: 1,
    team: startingTeam,
    phase: 'clue',
    clue: null,
    guessesMade: 0,
    history: [],
    result: null,
    selections: [],
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
  if (actor.team !== state.team) return 'not_your_turn';
  if (actor.role !== role) return role === 'captain' ? 'not_captain' : 'not_guesser';
  return null;
}

function endTurn(state: KeywordsState): KeywordsState {
  return {
    ...state,
    team: otherTeam(state.team),
    turn: state.turn + 1,
    phase: 'clue',
    clue: null,
    guessesMade: 0,
    selections: [],
  };
}

function finish(state: KeywordsState, winner: Team | null, reason: 'found' | 'reviewer2' | 'withdrawn'): KeywordsState {
  return { ...state, phase: 'over', clue: null, selections: [], result: { winner, reason } };
}

// The current team's captain gives a clue: one word and a number.
export function giveClue(
  state: KeywordsState,
  actor: Actor,
  action: Moment & { word: string; count: ClueCount },
): Outcome {
  const denied = refusal(state, action, actor, 'captain');
  if (denied) return refuse(denied);
  if (state.phase !== 'clue') return refuse('wrong_phase');
  if (!isClueCount(action.count)) return refuse('bad_count');
  const { problem } = checkClue(action.word, state.cards);
  if (problem) return refuse(problem);

  const word = cleanClue(action.word);
  return ok({
    ...state,
    phase: 'guess',
    clue: { word, count: action.count },
    guessesMade: 0,
    history: [...state.history, { turn: state.turn, team: state.team, word, count: action.count, guesses: [] }],
  });
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

// One of the current team's guessers reveals a card. The board has changed then, so everyone's
// choice is cleared, and the guessers choose again if their turn goes on.
export function reveal(state: KeywordsState, actor: Actor, action: Moment & { card: number }): Outcome {
  const denied = refusal(state, action, actor, 'guesser');
  if (denied) return refuse(denied);
  if (state.phase !== 'guess') return refuse('wrong_phase');
  const target = Number.isInteger(action.card) ? state.cards[action.card] : undefined;
  if (!target) return refuse('no_such_card');
  if (target.revealed) return refuse('card_revealed');

  const cards = state.cards.map((card, index) => (index === action.card ? { ...card, revealed: true } : card));
  const history = state.history.map((record, index) =>
    index === state.history.length - 1
      ? { ...record, guesses: [...record.guesses, { card: action.card, color: target.color }] }
      : record,
  );
  const next: KeywordsState = { ...state, cards, history, guessesMade: state.guessesMade + 1, selections: [] };

  // Reviewer 2 rejects the group that reveals them, whatever else is on the board.
  if (target.color === 'reviewer2') return ok(finish(next, otherTeam(state.team), 'reviewer2'));
  // A group wins as soon as all its cards are revealed, even by the other group.
  for (const team of TEAMS) {
    if (remaining(cards, team) === 0) return ok(finish(next, team, 'found'));
  }
  if (target.color !== state.team) return ok(endTurn(next));
  return ok(guessesLeft(next) === 0 ? endTurn(next) : next);
}

// The current team's guessers end their turn, which they may do once they have revealed a card.
export function pass(state: KeywordsState, actor: Actor, action: Moment): Outcome {
  const denied = refusal(state, action, actor, 'guesser');
  if (denied) return refuse(denied);
  if (state.phase !== 'guess') return refuse('wrong_phase');
  if (state.guessesMade === 0) return refuse('must_guess_first');
  return ok(endTurn(state));
}

// A guesser writes to their group, in either team's turn. Captains can't write: the clue is all
// they may say. A message names its game but no turn, because it is welcome in whatever turn it
// arrives. A group keeps its latest messages only.
export function say(state: KeywordsState, actor: Actor, action: Pick<Moment, 'gameId'> & { text: string }): Outcome {
  if (action.gameId !== state.gameId) return refuse('stale');
  if (state.phase === 'over') return refuse('game_over');
  if (actor.team === null || actor.role !== 'guesser') return refuse('not_guesser');
  const { text, problem } = checkChat(action.text);
  if (problem) return refuse(problem);
  const said = state.chat[actor.team];
  const message = { id: (said.at(-1)?.id ?? 0) + 1, player: actor.id, turn: state.turn, text };
  return ok({ ...state, chat: { ...state.chat, [actor.team]: [...said, message].slice(-CHAT_KEPT) } });
}

// The chair ends the game early. Nobody wins. A withdrawal names its game like every other
// action, so that one that arrives late can't end the next game. The turn doesn't matter to it.
export function withdraw(state: KeywordsState, action: Pick<Moment, 'gameId'>): Outcome {
  if (action.gameId !== state.gameId) return refuse('stale');
  if (state.phase === 'over') return refuse('game_over');
  return ok(finish(state, null, 'withdrawn'));
}
