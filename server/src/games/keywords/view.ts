import type { CardView, KeywordsView } from '@reviewer2/shared';
import { guessesLeft, remaining, type KeywordsState } from './state';

// The only way game state leaves the server (docs/rules/constraints.md). Captains see the key:
// the color of every card. Everyone else, guessers, spectators and screens, sees the colors of
// revealed cards only, and the other cards carry no color at all, not even an empty one, so that
// nothing gives the key away in the browser's developer tools. Once the game is over, everyone
// sees everything.
export type Sees = 'key' | 'public';

export function viewFor(state: KeywordsState, sees: Sees): KeywordsView {
  const showKey = sees === 'key' || state.phase === 'over';
  return {
    gameId: state.gameId,
    turn: state.turn,
    team: state.team,
    phase: state.phase,
    startingTeam: state.startingTeam,
    cards: state.cards.map(({ word, color, revealed, translations }): CardView => ({
      word,
      revealed,
      ...(revealed || showKey ? { color } : {}),
      ...(translations ? { translations: [...translations] } : {}),
    })),
    remaining: { red: remaining(state.cards, 'red'), blue: remaining(state.cards, 'blue') },
    clue: state.clue && { ...state.clue },
    guessesMade: state.guessesMade,
    guessesLeft: guessesLeft(state),
    history: state.history.map((record) => ({ ...record, guesses: record.guesses.map((guess) => ({ ...guess })) })),
    result: state.result && { ...state.result },
  };
}
