import type {
  CardColor,
  ChatMessage,
  ClueCount,
  ClueRecord,
  GameResult,
  KeywordsSettings,
  Language,
  Selection,
  Team,
  TurnPhase,
} from '@reviewer2/shared';

// The full state of one game. It never leaves the server as it is: view.ts decides what each
// player sees of it.

export interface Card {
  word: string;
  // The same term in the other languages of the word library, if it has any, and the other forms
  // of the term that the library lists, in any language.
  translations?: readonly string[];
  forms?: readonly string[];
  color: CardColor;
  revealed: boolean;
}

// When the current phase ends by itself, on the room's clock, and how long it was given, both in
// milliseconds.
export interface Clock {
  ends: number;
  length: number;
}

export interface KeywordsState {
  gameId: string;
  // The room's settings and language when the game started. They don't change during a game.
  settings: KeywordsSettings;
  language: Language;
  cards: Card[];
  startingTeam: Team;
  turn: number;
  team: Team; // whose turn it is
  phase: TurnPhase;
  // Null when the phase has no time limit, and once the game is over.
  clock: Clock | null;
  clue: { word: string; count: ClueCount } | null;
  guessesMade: number; // in this turn
  history: ClueRecord[];
  result: GameResult | null;
  // The cards that guessers of the current team have chosen in this turn, one for each of them
  // at most.
  selections: Selection[];
  // What the guessers of each team have written to their group, oldest first.
  chat: Record<Team, ChatMessage[]>;
}

export const remaining = (cards: readonly Card[], team: Team): number =>
  cards.filter((card) => card.color === team && !card.revealed).length;

// How many more cards the guessers may reveal this turn, or null when there is no limit (the free
// rule, or a clue of 0 or 'unlimited' under the standard rule) or no clue yet.
export function guessesLeft(state: KeywordsState): number | null {
  if (state.phase !== 'guess' || !state.clue || state.settings.guessRule === 'free') return null;
  const { count } = state.clue;
  if (count === 'unlimited' || count === 0) return null;
  return count + 1 - state.guessesMade;
}
