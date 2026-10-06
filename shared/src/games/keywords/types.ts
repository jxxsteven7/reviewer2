// Types for the team word guessing game, whose module is called `keywords`. The rules are in
// docs/games/keywords.md; the server holds the full state, and these are the shapes that both
// sides agree on.

export const TEAMS = ['red', 'blue'] as const;
export type Team = (typeof TEAMS)[number];

export const otherTeam = (team: Team): Team => (team === 'red' ? 'blue' : 'red');

// A card is one team's keyword, an irrelevant paper, or Reviewer 2, who rejects the group that
// reveals them.
export type CardColor = Team | 'neutral' | 'reviewer2';

// The captain gives the clues (shown as the group's PI); guessers reveal cards (shown as students).
export type Role = 'captain' | 'guesser' | 'spectator';

// Where a player sits. Spectators belong to no team.
export type Seat = { team: Team; role: 'captain' | 'guesser' } | { team: null; role: 'spectator' };

export const SPECTATOR: Seat = { team: null, role: 'spectator' };

export const BOARD_SIZE = 25;
// How many cards of each kind a board has. The team that starts gets the extra card.
export const CARD_COUNTS = { starting: 9, second: 8, neutral: 7, reviewer2: 1 } as const;

// The number that comes with a clue. 1 to 9 allow that many guesses plus one; 0 and
// 'unlimited' allow any number of guesses, as in the standard rules.
export type ClueCount = number | 'unlimited';
export const MAX_CLUE_NUMBER = 9;

export const isClueCount = (value: unknown): value is ClueCount =>
  value === 'unlimited' || (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_CLUE_NUMBER);

// 'clue': the current team's captain is thinking; 'guess': the guessers are revealing cards;
// 'over': the game has ended.
export type TurnPhase = 'clue' | 'guess' | 'over';

export type EndReason = 'found' | 'reviewer2' | 'withdrawn';

export interface GameResult {
  winner: Team | null; // null when the chair withdrew the game
  reason: EndReason;
}

// What a player sees of a card. `color` is there only when the player may know it: the card has
// been revealed, the player is a captain, or the game is over. Otherwise the key is absent.
export interface CardView {
  word: string;
  revealed: boolean;
  color?: CardColor;
}

export interface ClueRecord {
  turn: number;
  team: Team;
  word: string;
  count: ClueCount;
  guesses: { card: number; color: CardColor }[];
}

export interface KeywordsView {
  gameId: string;
  turn: number;
  team: Team;
  phase: TurnPhase;
  startingTeam: Team;
  cards: CardView[];
  remaining: Record<Team, number>;
  clue: { word: string; count: ClueCount } | null;
  guessesMade: number;
  // How many more cards the guessers may reveal this turn, or null when there is no limit.
  guessesLeft: number | null;
  history: ClueRecord[];
  result: GameResult | null;
}

// Why the server refused a game action. The order of the checks (see docs/games/keywords.md)
// makes sure that the answer never depends on the color of a card.
export type KeywordsError =
  | 'stale'
  | 'game_over'
  | 'not_your_turn'
  | 'not_captain'
  | 'not_guesser'
  | 'wrong_phase'
  | 'no_such_card'
  | 'card_revealed'
  | 'must_guess_first'
  | 'clue_empty'
  | 'clue_not_one_word'
  | 'clue_too_long'
  | 'clue_on_board'
  | 'bad_count';

// Why a seat can't be taken, or why a game can't start yet.
export type SeatError = 'seat_taken' | 'key_viewer' | 'other_team' | 'bad_seat';
export type StartProblem = { problem: 'needs_captain' | 'needs_guesser' | 'captain_offline'; team: Team };
