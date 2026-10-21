import type { BoardWord } from '@reviewer2/shared';
import type {
  Fate,
  ImpostorResult,
  ImpostorRole,
  ImpostorSettings,
  Phase,
  ReportVerdict,
} from '@reviewer2/shared/impostor';

// The state of the hidden word game (docs/games/impostor.md), which stays on the server: views.ts
// decides what each viewer sees of it. Players are known by their player IDs throughout, and by
// their numbers only where the players see them.

export interface GamePlayer {
  id: string;
  number: number;
  role: ImpostorRole;
  agent: boolean;
  fate: Fate;
  // The round they went out in, or null while they are in the game.
  out: number | null;
}

// A line of the game: a description, or null when the writer's time ran out, and whether it was
// the line that a player tied for the most votes added.
export interface Line {
  round: number;
  by: string;
  text: string | null;
  tie: boolean;
}

// A vote that has been revealed: whom each voter voted for, by player ID, null for an abstention
// and 'timeout' when their time ran out; who went out, if anyone; and who was tied for the most
// votes, when nobody did.
export interface Ballot {
  round: number;
  ballot: 'vote' | 'revote';
  votes: Record<string, string | null | 'timeout'>;
  out: string | null;
  tied: string[];
}

// A report: who reported whom in which round, the line they pointed at, as its index in
// ImpostorGame.lines, or null, and the reason; who may judge it, everyone still in the game but the
// reported player, and the verdicts so far, which nobody sees until it is over; when the time to
// judge it runs out, on the room's clock; and whether it passed, once it is over.
export interface Report {
  round: number;
  by: string;
  target: string;
  line: number | null;
  reason: string;
  eligible: string[];
  verdicts: Record<string, ReportVerdict>;
  ends: number;
  passed: boolean | null;
}

// A guess of the students' word by a Reviewer 2 or the PI who was voted out: the word, or null
// when they made none, and whether it was right.
export interface Guess {
  by: string;
  word: string | null;
  correct: boolean;
}

// The clock of the phase: when it runs out, on the room's clock, and how long the phase had, in
// milliseconds. While a report is judged, the clock stands still with `left`, null for a phase
// without a clock.
export interface Clock {
  ends: number;
  length: number;
}

// Where the words came from: a pair of related terms of the word library, by its field, its key
// (pairKey in core/words.ts) and the IDs of the students' term and the Reviewer 2s' term; or the
// setter, who chose the field the words are of and whether to be named when the pair is adopted.
export type WordSource =
  | { kind: 'library'; field: string; pair: string; terms: { student: string; reviewer2: string } }
  | { kind: 'setter'; setter: string; field: string; named: boolean };

// A line of the off-field chat or of the talk after the game.
export interface Talk {
  by: string;
  text: string;
  after: boolean;
}

export interface ImpostorGame {
  gameId: string;
  settings: ImpostorSettings;
  // Everyone who plays, in the order of their numbers, which go from 1.
  players: GamePlayer[];
  words: { student: BoardWord; reviewer2: BoardWord };
  source: WordSource;
  round: number;
  phase: Phase;
  // Who describes now, in the describe and the tie phases.
  speaker: string | null;
  lines: Line[];
  ballots: Ballot[];
  // The votes of the vote being held, by voter: whom they voted for, or null for an abstention.
  pending: Record<string, string | null>;
  // Those tied for the most votes, in the tie and the revote phases.
  tied: string[];
  report: Report | null;
  reports: Report[];
  // Who may guess the students' word now, in the comeback phase.
  comeback: string | null;
  guesses: Guess[];
  clock: Clock | null;
  paused: { left: number | null; length: number } | null;
  result: ImpostorResult | null;
  // Whether the chair removed a player during the game, which then counts for no points.
  removed: boolean;
  // After a game with AI players: each person's guess of who they were, by numbers, or null for a
  // skip (docs/games/impostor.md#guessing-the-ai).
  agentGuesses: Record<string, number[] | null>;
  talk: Talk[];
}

// The setter's words for the next game, which only count while the one who set them chairs the
// room (docs/games/impostor.md#the-setter).
export interface SetterWords {
  by: string;
  a: string;
  b: string;
  field: string;
  named: boolean;
}

export interface ImpostorData {
  settings: ImpostorSettings;
  // Who plays the next game, in the order they came; whoever else is in the room watches.
  seats: string[];
  setterWords: SetterWords | null;
  game: ImpostorGame | null;
}
