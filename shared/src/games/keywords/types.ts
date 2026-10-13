import type { KeywordsSettings } from './settings';

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
export const ROLES = ['captain', 'guesser', 'spectator'] as const;
export type Role = (typeof ROLES)[number];

// Where a player sits. Spectators belong to no team. A seat is never changed: moving a player
// gives them another seat.
export type Seat =
  { readonly team: Team; readonly role: 'captain' | 'guesser' } | { readonly team: null; readonly role: 'spectator' };

// Every spectator shares this one seat, so it is frozen.
export const SPECTATOR: Seat = Object.freeze({ team: null, role: 'spectator' });

export const BOARD_SIZE = 25;
// How many cards of each kind a board has. The team that starts gets the extra card.
export const CARD_COUNTS = { starting: 9, second: 8, neutral: 7, reviewer2: 1 } as const;

// The number that comes with a clue. Which numbers a room allows, and what they mean, depends on
// its guess rule (clueCounts() in settings.ts).
export type ClueCount = number | 'unlimited';
export const MAX_CLUE_NUMBER = 9;

// 'clue': the current team's captain is thinking; 'guess': the guessers are revealing cards;
// 'over': the game has ended.
export type TurnPhase = 'clue' | 'guess' | 'over';

export type EndReason = 'found' | 'reviewer2' | 'withdrawn';

export interface GameResult {
  winner: Team | null; // null when the chair withdrew the game
  reason: EndReason;
}

// A term for a card: the word in the room's language and, when the word library has them, the
// same term in its other languages, and the other forms of the term that the library lists in
// any language, such as "dataset" for "Data". A Chinese word also comes with its pinyin, which
// the server works out, without tones and with a space between the syllables. The clue check
// holds a clue against all of these (see clue.ts).
export interface BoardWord {
  word: string;
  translations?: readonly string[];
  forms?: readonly string[];
  pinyin?: string;
}

// What a player sees of a card. `color` is there only when the player may know it: the card has
// been revealed, the player is a captain, or the game is over. Otherwise the key is absent.
// `translations`, `forms` and `pinyin` are there when the card has any, for the clue check on the
// captain's screen. They are no secret.
export interface CardView {
  word: string;
  revealed: boolean;
  color?: CardColor;
  translations?: string[];
  forms?: string[];
  pinyin?: string;
}

// A turn in the record of the game. A captain who ran out of time gave no clue, and then `word`
// and `count` are null. `timedOut` marks a turn that ended because its time ran out, before the
// clue or during the guesses. Each guess names the player who revealed the card, by player ID.
//
// `captain` is the player who gave the clue, or who was in the captain's seat when the time for it
// ran out, if anyone was, and `targets` the cards that they marked as the ones the clue was meant
// for, if they marked any (docs/games/keywords.md#the-clue). The targets are the captain's secret
// until the game is over: no view carries them before then, the captain's own included. `at`, on
// the clue and on each guess, is when it came, in milliseconds from the start of the game; for a
// turn without a clue, when its time ran out. Replays from before these were kept have none of
// them, and a turn without a clue had no captain before the missed deadlines were counted.
export interface ClueRecord {
  turn: number;
  team: Team;
  word: string | null;
  count: ClueCount | null;
  guesses: { card: number; color: CardColor; player: string; at?: number }[];
  timedOut?: true;
  captain?: string;
  targets?: number[];
  at?: number;
}

// What happened in a game besides the clues and the guesses: the chair paused the game and resumed
// it, and a group asked for an extension, for the clue log; and a captain missed the deadline for
// their clue, which the room hears of at once (docs/games/keywords.md#titles), while the clue log
// has the turn without a clue already. Each is noted with the turn it came in; an extension and a
// missed deadline name the group. A game keeps the last EVENTS_KEPT of them, more than a game has,
// so that no number of pauses can grow its snapshots without end.
export const EVENT_KINDS = ['paused', 'resumed', 'extended', 'missed'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const EVENTS_KEPT = 50;

export interface GameEvent {
  turn: number;
  kind: EventKind;
  team?: Team;
  // A missed deadline names the captain, by player ID, and, for a captain with an account, how many
  // times they have missed one, this time included, as their titles and the game so far count them.
  player?: string;
  count?: number;
}

// A card that a guesser has chosen but not revealed yet, for the rest of their group to see.
export interface Selection {
  player: string;
  card: number;
}

// A message that a guesser wrote to their group, with the turn in which it was written. The IDs
// of a group's messages count up from 1, also when the oldest messages have been dropped.
export interface ChatMessage {
  id: number;
  player: string;
  turn: number;
  text: string;
}

export interface KeywordsView {
  gameId: string;
  turn: number;
  team: Team;
  phase: TurnPhase;
  startingTeam: Team;
  // The board, or no cards at all while the game is paused: nobody studies the board during a
  // break, the captains and the screens included.
  cards: CardView[];
  // Whether the chair has paused the game. Every action but the chat is refused meanwhile, and
  // the clock stands still at `clock.left`.
  paused: boolean;
  remaining: Record<Team, number>;
  clue: { word: string; count: ClueCount } | null;
  guessesMade: number;
  // How many more cards the guessers may reveal this turn, or null when there is no limit or no
  // clue yet. Under the free rule there is never a limit.
  guessesLeft: number | null;
  // How long the current phase has left before the server ends it, and how long it was given, in
  // milliseconds, as the server counted when it sent the view. Null when the phase has no time
  // limit, and once the game is over. A client draws its countdown from this, counting from when
  // the view arrived, and leaves ending the phase to the server.
  clock: { left: number; total: number } | null;
  history: ClueRecord[];
  events: GameEvent[];
  // Which groups have used their one extension of the game (docs/games/keywords.md#extensions).
  extended: Record<Team, boolean>;
  result: GameResult | null;
  // The cards that the guessers of the team whose turn it is have chosen. Only that team's
  // captain and guessers get this; for everyone else the key is absent.
  selections?: Selection[];
  // The messages of the viewer's own group. Only a captain or a guesser gets this; spectators
  // and screens don't.
  chat?: ChatMessage[];
}

// Why the server refused a game action. The order of the checks (see docs/games/keywords.md)
// makes sure that the answer never depends on the color of a card.
export const KEYWORDS_ERRORS = [
  'stale',
  'game_over',
  'not_your_turn',
  'not_captain',
  'not_guesser',
  'wrong_phase',
  'no_such_card',
  'card_revealed',
  'must_guess_first',
  'clue_empty',
  'clue_not_one_word',
  'clue_too_many_words',
  'clue_too_long',
  'clue_on_board',
  'bad_count',
  'bad_targets',
  'chat_empty',
  'chat_too_long',
  'not_chair',
  'paused',
  'not_paused',
  'no_extension',
  'extension_used',
] as const;
export type KeywordsError = (typeof KEYWORDS_ERRORS)[number];

// Why a seat can't be taken.
// `between_games`: in a match, only those who have played for a group in the game being played
// may sit in one until it ends; anyone else joins from the next game. `bigger_group`: in a match
// whose groups are fixed, a newcomer joins the group with fewer players.
export const SEAT_ERRORS = [
  'seat_taken',
  'key_viewer',
  'other_team',
  'bad_seat',
  'between_games',
  'bigger_group',
] as const;
export type SeatError = (typeof SEAT_ERRORS)[number];

// What keeps a game from starting, for each team, or, when the server draws the groups at the
// start of a match's game, how many more players need to be online in a seat.
export const START_PROBLEMS = ['needs_captain', 'captain_offline', 'needs_guesser'] as const;
export type StartProblem =
  { problem: (typeof START_PROBLEMS)[number]; team: Team } | { problem: 'needs_players'; missing: number };

// How the waiting room seats the players. 'free': everyone chooses a group and a role, as in a
// room that isn't a match. 'draw': the players only say that they play, and the server draws the
// groups and their PIs when the game starts. 'fixed': in a match whose groups don't change, after
// its first game, everyone plays for their group again, and the PI's seat goes round.
export const LINEUPS = ['free', 'draw', 'fixed'] as const;
export type Lineup = (typeof LINEUPS)[number];

// The game's part of the room view (RoomView.data).
export interface KeywordsRoomData {
  // The room's settings, which everyone sees. A game plays with those that the room had when it
  // started, and they can't change until the room is back in the waiting room.
  settings: KeywordsSettings;
  // Where every member of the room sits.
  seats: Record<string, Seat>;
  // The members who have seen the key during the current game, and so can't be guessers in it.
  keyViewers: string[];
  // The group that the viewer plays for in the current game, or in a match whose groups don't
  // change, so that the interface offers only the seats they may take. Null for a screen and for
  // anyone who hasn't sat in a group yet.
  side: Team | null;
  // How the waiting room seats the players.
  lineup: Lineup;
  // Whether the viewer came to play while a game of the match was on, and so plays from the next.
  joinsNext: boolean;
  // What still keeps the game from starting; empty outside the waiting room.
  startProblems: StartProblem[];
  game: KeywordsView | null;
}
