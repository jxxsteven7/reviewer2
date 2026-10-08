import type { CardView, KeywordsView, Seat } from '@reviewer2/shared';
import { guessesLeft, remaining, type KeywordsState } from './state';

// The only way game state leaves the server (docs/rules/constraints.md). What a viewer gets
// depends on the seat they are in right now; a screen gets what a spectator gets.
//
// - Captains see the key: the color of every card. Everyone else sees the colors of revealed
//   cards only, and the other cards carry no color at all, not even an empty one, so that
//   nothing gives the key away in the browser's developer tools. Once the game is over,
//   everyone sees every color.
// - A group's chat goes to its own captain and guessers, and the cards that its guessers have
//   chosen go to them while it is the group's turn. Nobody else gets either: the keys are absent.
//
// `at` is the time on the room's clock when the view is sent, from which the view counts how
// long the current phase has left.
export function viewFor(state: KeywordsState, viewer: Seat, at: number): KeywordsView {
  const showKey = viewer.role === 'captain' || state.phase === 'over';
  const view: KeywordsView = {
    gameId: state.gameId,
    turn: state.turn,
    team: state.team,
    phase: state.phase,
    startingTeam: state.startingTeam,
    cards: state.cards.map(({ word, color, revealed, translations, forms }): CardView => ({
      word,
      revealed,
      ...(revealed || showKey ? { color } : {}),
      ...(translations ? { translations: [...translations] } : {}),
      ...(forms ? { forms: [...forms] } : {}),
    })),
    remaining: { red: remaining(state.cards, 'red'), blue: remaining(state.cards, 'blue') },
    clue: state.clue && { ...state.clue },
    guessesMade: state.guessesMade,
    guessesLeft: guessesLeft(state),
    clock: state.clock && { left: Math.max(0, state.clock.ends - at), total: state.clock.length },
    history: state.history.map((record) => ({ ...record, guesses: record.guesses.map((guess) => ({ ...guess })) })),
    result: state.result && { ...state.result },
  };
  if (viewer.team !== null) {
    view.chat = state.chat[viewer.team].map((message) => ({ ...message }));
    if (viewer.team === state.team) view.selections = state.selections.map((selection) => ({ ...selection }));
  }
  return view;
}
