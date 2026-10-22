import type { ReplayPerson } from '../../replay';
import type { BoardWord } from '../../words';
import type { ImpostorSettings } from './settings';

// The hidden word game (docs/games/impostor.md): most players, the students, get one of two close
// terms, one or two, the Reviewer 2s, get the other without knowing it, and in a larger game a PI
// gets none. Each round everyone describes their word in a line, in the order of their numbers,
// and then all vote at once on whom to vote out.

export const IMPOSTOR_ROLES = ['student', 'reviewer2', 'pi'] as const;
export type ImpostorRole = (typeof IMPOSTOR_ROLES)[number];

// How a player's game went: still in it, voted out, out for breaking the rules after a report, or
// gone from the room.
export const FATES = ['alive', 'voted_out', 'violation', 'left'] as const;
export type Fate = (typeof FATES)[number];

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 12;

// How long the players who may judge a report have, how long a Reviewer 2 or a PI who was voted out
// has to guess the students' word, and how long a report's reason may be, in characters.
export const REPORT_SECONDS = 20;
export const COMEBACK_SECONDS = 30;
export const MAX_REASON_LENGTH = 60;

// The longest description, reason or guess that is looked at at all, in UTF-16 units as it arrives.
export const MAX_LINE_INPUT = 1000;

// How many lines of the off-field chat and the talk after the game a game keeps, the latest. Every
// change to a room sends everyone who may read the chat a whole snapshot with it, so the chat
// decides how large a snapshot can get, as a group's chat does in the first game (CHAT_KEPT).
// Thirty lines are what the sidelines have said over the last round or so, and at most 30,000
// UTF-16 units in a snapshot. The log of the game keeps every line all the same.
export const TALK_KEPT = 30;

// How many Reviewer 2s and PIs a game of this many players has: one Reviewer 2 in a game of 4 or 5,
// one and a PI in one of 6 to 8, two and a PI in one of 9 to 12, and no PI when the room has none.
export function roleCounts(players: number, pi: boolean): { reviewer2: number; pi: number } {
  if (players < 6) return { reviewer2: 1, pi: 0 };
  return { reviewer2: players < 9 ? 1 : 2, pi: pi ? 1 : 0 };
}

// The Reviewer 2s win once no more than this many players are left in the game, with one of them
// still among them: 2 in a game that began with up to 6 players, 3 in a larger one.
export const survivors = (players: number): number => (players <= 6 ? 2 : 3);

// The phases of a round: everyone describes their word; everyone votes; the players tied with the
// most votes each describe it once more; the others vote again among them; and a Reviewer 2 or a
// PI who was voted out may guess the students' word.
export const PHASES = ['describe', 'vote', 'tie', 'revote', 'comeback', 'over'] as const;
export type Phase = (typeof PHASES)[number];

// How the game ended: the students voted out every Reviewer 2 and the PI; the PI outlasted the
// Reviewer 2s; a Reviewer 2 lasted until few were left; a Reviewer 2 or the PI guessed the students'
// word after being voted out; or a Reviewer 2 left the room, which ends the game with no winner.
export const REASONS = ['caught', 'pi_survived', 'survived', 'comeback', 'reviewer2_left'] as const;
export type ImpostorReason = (typeof REASONS)[number];

export const VERDICTS = ['agree', 'disagree', 'abstain'] as const;
export type ReportVerdict = (typeof VERDICTS)[number];

// The game's own refusals, besides those that it shares with the first game, such as stale,
// game_over, wrong_phase, bad_settings, needs_human and agent_limit, and those of what players write
// (lines.ts). `table_full`: 12 players play at most. `not_playing`: only a player still in the game
// may do that. `not_speaker`: someone else describes now. `bad_vote`: a vote for oneself, for someone
// out or, in a revote, for someone who isn't tied. `report_open`: one report is judged at a time;
// `reported_already`: one report a round each; `bad_report`: a report of oneself, of someone out, or
// pointing at a line that isn't the reported player's. `cannot_judge`: the reported player, and
// whoever is out, doesn't judge. `cannot_talk`: the off-field chat is for those who are out, watch
// or set the words. `guess_first`: a player who is to guess the AI players after the game talks
// once they have guessed or skipped it. `not_setter`, `bad_field` and `account_required`: only the
// setter sets the words, of a field of the word library, and the setter needs an account.
// `private_only`: the god view and the setter are for a private room.
export const IMPOSTOR_ERRORS = [
  'table_full',
  'not_playing',
  'not_speaker',
  'voted_already',
  'bad_vote',
  'report_open',
  'reported_already',
  'bad_report',
  'cannot_judge',
  'judged_already',
  'no_comeback',
  'cannot_talk',
  'guess_first',
  'not_setter',
  'bad_field',
  'line_empty',
  'line_too_long',
  'line_has_word',
  'line_repeated',
  'chat_has_word',
  'words_missing',
  'words_too_long',
  'words_same',
] as const;
export type ImpostorError = (typeof IMPOSTOR_ERRORS)[number];

// What keeps a game from starting: too few players or too many, with how many more or fewer are
// needed, the setter's words not set, or, with AI players, no time limits, which keep a game going
// when the agent is slow, or no person playing.
export const IMPOSTOR_START_PROBLEMS = [
  'needs_players',
  'too_many_players',
  'needs_words',
  'needs_timers',
  'needs_human',
] as const;
export interface ImpostorStartProblem {
  problem: (typeof IMPOSTOR_START_PROBLEMS)[number];
  count?: number;
}

// A line of a game, as everyone sees it: the round, who wrote it, by number, and what, or null
// when their time ran out, and whether it was the line a player tied for the most votes added.
export interface LineView {
  round: number;
  number: number;
  text: string | null;
  tie: boolean;
}

// A vote as everyone sees it once it is revealed: whom each player voted for, by number, 0 for an
// abstention and -1 when their time ran out. `ballot` is the first vote of the round or the revote
// among the tied players.
export interface BallotView {
  round: number;
  ballot: 'vote' | 'revote';
  votes: Record<number, number>;
  out: number | null;
  tied: number[];
}

// A report, as everyone sees it: who reported whom, the line they pointed at, as its index among the
// game's lines, or null, the reason, how many may judge it and have, and, once it is over, every
// verdict and whether it passed. The reporter and the players who may judge it see their own
// verdict while it is on.
export interface ReportView {
  round: number;
  by: number;
  target: number;
  line: number | null;
  reason: string;
  eligible: number;
  judged: number;
  mine: ReportVerdict | null;
  mayJudge: boolean;
  verdicts: Record<number, ReportVerdict> | null;
  passed: boolean | null;
}

// A seat of the game, by its number: how it stands, the role, once it is known, which everyone
// learns of a player who is out, the player behind it, which nobody but the player sees in an
// anonymous game until it ends, and whether an AI plays it, which nobody sees until then either.
export interface SeatView {
  number: number;
  fate: Fate;
  out: number | null;
  role: ImpostorRole | null;
  playerId: string | null;
  agent: boolean | null;
}

// A word as the player who has it knows it: the word, its forms, its terms in the other languages
// and, for a Chinese word, its pinyin, which a line may not give away (lines.ts), so that the page
// checks a line as the server does and names what it gave away.
export type OwnWord = Pick<BoardWord, 'word' | 'forms' | 'translations' | 'pinyin'>;

// A line of the off-field chat, or of the talk after the game, by the number of a player of the
// game, or the player ID of someone who only watched or set the words. Its ID goes up from 1 in the
// game, so that the page tells a new line from the last one kept.
export interface OffFieldLine {
  id: number;
  number: number | null;
  playerId: string | null;
  text: string;
  after: boolean;
}

// How the game came out.
export interface ImpostorResult {
  winner: ImpostorRole | null;
  reason: ImpostorReason;
}

// One player's points in the game that ended, and where they came from (ImpostorDetail).
export interface ImpostorPoints {
  number: number;
  points: number;
}

// The viewer's guess of who the AI players were, after a game with AI players and at least 3
// people: how many AI players there were, and the viewer's guess, by numbers, null for a skip, or
// undefined while they haven't guessed. Only a person who played in the game guesses.
export interface AgentGuessView {
  agents: number;
  guess: number[] | null | undefined;
}

// The game as one viewer sees it (view.ts on the server).
export interface ImpostorView {
  gameId: string;
  round: number;
  phase: Phase;
  players: number;
  // The viewer's own number, role and word, when they play: the role once they are out or the
  // game is over, and the word all along, with what a line may not give away of it, null for the
  // PI. The setter's two words, in no order.
  you: { number: number; role: ImpostorRole | null; word: OwnWord | null } | null;
  setterWords: string[] | null;
  // The words the viewer knows, which their lines off the field may not name while the game is on
  // (knownWords() in view.ts): their own, both for the setter and with the god view, none for the
  // PI or whoever only watches, each with what a line may not give away of it, as the server holds
  // the line against them.
  known: OwnWord[];
  // Who set the words of the game, by player ID, for everyone, as the waiting room showed it, or
  // null for a game of words from the library. The chair may have passed to someone else since.
  setter: string | null;
  seats: SeatView[];
  speaker: number | null;
  clock: { left: number; total: number } | null;
  lines: LineView[];
  ballots: BallotView[];
  // The numbers who have voted in the vote being held, the viewer's own vote, and who may be voted
  // for: everyone left, or the tied players in a revote.
  voted: number[];
  myVote: number | null | undefined;
  candidates: number[];
  tied: number[];
  report: ReportView | null;
  reports: ReportView[];
  // Whether the viewer has reported someone in this round.
  reported: boolean;
  // The number who may guess the students' word now, and the guesses so far: everyone sees that a
  // guess was wrong.
  comeback: number | null;
  guesses: { number: number; correct: boolean }[];
  result: ImpostorResult | null;
  // Both words and every role, once the game is over or for a viewer with the god view: who had
  // which word, and which number was whom, which a person who played in a game with AI players
  // sees once they have guessed.
  words: { student: string; reviewer2: string } | null;
  revealed: boolean;
  guess: AgentGuessView | null;
  points: ImpostorPoints[] | null;
  // The off-field chat, for those who are out, watch or set the words, and the talk after the game.
  offField: OffFieldLine[] | null;
  mayTalk: boolean;
}

// The game's part of the room view.
export interface ImpostorRoomData {
  settings: ImpostorSettings;
  // Who plays the next game, in the order they came.
  seats: string[];
  startProblems: ImpostorStartProblem[];
  // The setter's words, for the setter alone, while the room waits: the two words, the field and
  // whether they are to be named when the pair is adopted. The setter is the chair.
  setterWords: { a: string; b: string; field: string; named: boolean } | null;
  mayEmote: boolean;
  game: ImpostorView | null;
}

// A kept game of the hidden word game, as an account that played in it, or set its words, watches
// it again (docs/architecture.md#replays): the settings, both words and where they came from, every
// player by number with their role and how their game went, every line, vote, report and guess, how
// it came out, and everyone's points. `people` says who everyone was, by player ID, and `me` is the
// player ID that the account watching had, if it played; `setter` is the setter, if any.
export interface ImpostorReplay {
  gameId: string;
  settings: ImpostorSettings;
  words: { student: string; reviewer2: string };
  source: { kind: 'library' | 'setter'; field: string };
  players: (SeatView & { role: ImpostorRole; playerId: string; agent: boolean })[];
  lines: LineView[];
  ballots: BallotView[];
  reports: ReportView[];
  guesses: { number: number; word: string | null; correct: boolean }[];
  result: ImpostorResult;
  points: ImpostorPoints[];
  people: Record<string, ReplayPerson>;
  me: string | null;
  setter: string | null;
}
