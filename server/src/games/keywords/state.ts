import type {
  CardColor,
  CardMark,
  ChatMessage,
  ClueCount,
  ClueRecord,
  GameEvent,
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
  // The same term in the other languages of the word library, if it has any, the other forms of
  // the term that the library lists, in any language, the pinyin of a Chinese word and the English
  // meanings of its characters.
  translations?: readonly string[];
  forms?: readonly string[];
  pinyin?: string;
  glosses?: readonly string[];
  // A word of the chair's own (docs/games/keywords.md#custom-words), which the record of the game
  // marks; a word of the lists has none.
  custom?: true;
  color: CardColor;
  revealed: boolean;
}

// When the current phase ends by itself, on the room's clock, and how long it was given, both in
// milliseconds.
export interface Clock {
  ends: number;
  length: number;
}

// A pause: how much time the phase had left when the chair paused the game, in milliseconds, or
// null for a phase without a time limit. The clock starts again from there when the game resumes.
export interface Pause {
  left: number | null;
}

// A turn of the record as it leaves the state, in a view or a replay: a copy that shares nothing
// with the state, its guesses and targets included.
export const copyRecord = (record: ClueRecord): ClueRecord => ({
  ...record,
  guesses: record.guesses.map((guess) => ({ ...guess })),
  ...(record.targets ? { targets: [...record.targets] } : {}),
});

export interface KeywordsState {
  gameId: string;
  // When the game started, on the room's clock, from which the record counts the time of each clue
  // and each guess (ClueRecord.at).
  startedAt: number;
  // The room's settings and language when the game started. They don't change during a game.
  settings: KeywordsSettings;
  language: Language;
  cards: Card[];
  startingTeam: Team;
  turn: number;
  team: Team; // whose turn it is
  phase: TurnPhase;
  // Null when the phase has no time limit, and once the game is over. While the game is paused,
  // the clock stands still at `pause.left`, and `ends` means nothing.
  clock: Clock | null;
  pause: Pause | null;
  clue: { word: string; count: ClueCount } | null;
  guessesMade: number; // in this turn
  history: ClueRecord[];
  // The pauses and the extensions, for the clue log and the replay.
  events: GameEvent[];
  // Which groups have used their one extension of the game.
  extended: Record<Team, boolean>;
  result: GameResult | null;
  // The cards that guessers of the current team have chosen in this turn, one for each of them
  // at most.
  selections: Selection[];
  // What each group's guessers have marked the hidden cards as, one mark for a card at most. A
  // card's marks go once it is revealed.
  marks: Record<Team, CardMark[]>;
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
