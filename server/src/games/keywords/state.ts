import type { CardColor, ClueCount, ClueRecord, GameResult, Team, TurnPhase } from '@reviewer2/shared';

// The full state of one game. It never leaves the server as it is: view.ts decides what each
// player sees of it.

export interface Card {
  word: string;
  // The same term in the other languages of the word library, if it has any.
  translations?: readonly string[];
  color: CardColor;
  revealed: boolean;
}

export interface KeywordsState {
  gameId: string;
  cards: Card[];
  startingTeam: Team;
  turn: number;
  team: Team; // whose turn it is
  phase: TurnPhase;
  clue: { word: string; count: ClueCount } | null;
  guessesMade: number; // in this turn
  history: ClueRecord[];
  result: GameResult | null;
}

export const remaining = (cards: readonly Card[], team: Team): number =>
  cards.filter((card) => card.color === team && !card.revealed).length;

// How many more cards the guessers may reveal this turn, or null when there is no limit (a clue
// of 0 or 'unlimited') or no clue yet.
export function guessesLeft(state: KeywordsState): number | null {
  if (state.phase !== 'guess' || !state.clue) return null;
  const { count } = state.clue;
  if (count === 'unlimited' || count === 0) return null;
  return count + 1 - state.guessesMade;
}
