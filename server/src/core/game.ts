import type {
  Ack,
  AgentAnswer,
  AgentPersona,
  AgentQuestion,
  BoardWord,
  Language,
  MatchRules,
  ReplayMember,
  RoomPhase,
  Title,
} from '@reviewer2/shared';
import type { GameLogData } from './gameLog';
import type { Rng } from './random';

// What the shared layer needs from a game (docs/architecture.md). The shared layer runs rooms,
// players, connections and the chair's controls; a game module owns its seats, its rules and what
// each player may see. Modules keep their data immutable: every call returns new data.

export interface GameContext {
  phase: RoomPhase;
  language: Language;
  rng: Rng;
  // Who chairs the room, for what a game leaves to the chair alone, such as pausing it.
  chairId: string | null;
  // The room's clock, in milliseconds. It only runs forward, and only differences between its
  // readings mean anything.
  now(): number;
  // A player's member key, which stays the same when they leave and come back. The room also
  // knows the keys of those who have left during the current game.
  keyOf(playerId: string): string;
  // Who a player is, also one who has left during the current game, for what a game keeps of them,
  // such as a replay; null for someone the room doesn't know.
  whoIs(playerId: string): ReplayMember | null;
  // An AI player is online while the server's agent answers (docs/architecture.md#ai-players).
  isOnline(playerId: string): boolean;
  // The persona of an AI player, or null for a person.
  agentOf(playerId: string): AgentPersona | null;
  // Everyone in the room, in the order they joined.
  playerIds(): string[];
  // How many times the account of a player, also of one who has left during the current game, has
  // won a title, as its record has it, or null when there is no count to give: for a guest, who
  // keeps none, in a game that an AI has played in, which awards none
  // (docs/architecture.md#ai-players), and when the record can't be read.
  titleCount(playerId: string, title: Title): number | null;
  // Whether the game's titles go to a player, also to one who has left during the current game:
  // to one with an account, where the server keeps accounts, in a game that no AI has played in.
  awardsTitles(playerId: string): boolean;
}

// An account that played in a game, as a replay shows it: its username, avatar and handle as they
// are when the replay is opened.
export interface ShownAccount {
  username: string;
  avatar: string | null;
  handle: string;
}

// A replay as it was kept, for an account to watch (GameModule.showReplay): the replay as the game
// gave it; the log of the game, if it was kept (gameLog.ts), read when asked for, since a replay
// that keeps its groups has no need of it; the accounts that played in it as they are now, by the
// player ID each had; and the IDs that the account watching had in it.
export interface KeptReplay {
  replay: unknown;
  log: () => GameLogData | null;
  accounts: ReadonlyMap<string, ShownAccount>;
  viewer: ReadonlySet<string>;
}

// Who is looking: a member of the room, or a screen that only watches.
export type Viewer = { playerId: string } | { screen: true };

// What a module answers when it is asked to change its data: the new data, or a refusal with one
// of the game's error codes.
export type GameUpdate<Data> = Ack<{ data: Data }>;

// One player's part in a game that has ended, as the game describes it, for the record of a player
// with an account: which side they played for and in what role, which side won, whether they did,
// the game's own word for how it went, such as the verdict of a decision letter, and the titles
// that the game brought them, if any.
export interface PlayerResult {
  playerId: string;
  side: string;
  role: string;
  winner: string;
  won: boolean;
  verdict: string;
  titles?: GameTitle[];
}

// How a game that finished came out (docs/architecture.md#game-records), for its record: which side
// won, in the game's own words, and how, such as by finding every card of its own or because the
// other side revealed Reviewer 2, so that games can be told apart by it without the replay.
export interface GameOutcome {
  winner: string;
  reason: string;
}

// A title that a game brought a player (docs/architecture.md#titles), with the turn of the game it
// came in, or whatever the game counts its moments in, which tells it apart from the same title
// won again later in the game. The record keeps each once.
export interface GameTitle {
  title: Title;
  turn: number;
}

// What an AI player did in a game that finished, in the game's own counts, for its page
// (docs/architecture.md#ai-players): the clues it gave as a PI and how many of its group's cards
// they found, how often it revealed Reviewer 2 as a student, and the clue that found the most, if
// any found one.
export interface AgentFeats {
  clues: number;
  found: number;
  reviewer2: number;
  best: { word: string; found: number } | null;
}

// What the log of a game keeps of one of the game's messages that changed the game
// (docs/architecture.md#game-records): what the message carried, as the game reads it, and, for a
// line of a group's chat, what the player said, which the log keeps apart, so that it can be taken
// out again when their account is deleted.
export interface LogNote {
  data?: unknown;
  said?: string;
}

// An entry that the log of a game keeps of a change of the game's own (GameModule.logChanges): its
// type, in the game's words, and what it says.
export interface GameLogNote {
  type: string;
  data?: unknown;
}

// What an AI is to do in a seat now (GameModule.agentTask; docs/architecture.md#ai-players).
export interface AgentTask {
  // The moment of the game it is for, such as a turn and its phase, in the game's own words. Once
  // the game has moved on, the task is dropped, and so is its answer when it comes. Two seats whose
  // tasks are for the same moment would do the same thing, as two students of a group would, so
  // the driver gives the task to one of them.
  moment: string;
  // What the seat is to do, in the game's words, for the AI's log, such as "clue" or "guess".
  kind: string;
  // What to ask the agent, from the seat's own view of the game.
  question: AgentQuestion;
  // Advice for the people of the seat's group, who decide what to do with it, as an AI student
  // gives its group. An AI player gives it; an AI that plays for someone who is offline doesn't,
  // since the people who are there can play the turn themselves.
  advice: boolean;
  // How long the moves wait, in milliseconds: the first from when the task came up, each one after
  // from the one before, so that an AI plays at a pace that people can follow.
  pace: { first: number; step: number };
}

// One of the game's messages that an AI sends for its seat, as a player's page would.
export interface AgentMove {
  type: string;
  payload: unknown;
}

// The seats of a practice room (GameModule.practice): the game's message that takes its creator to
// their seat, as their page would send it, and the seats of the AI players, in the order they are
// invited, as seatAgent() reads a seat.
export interface PracticeSeats {
  seat: { type: string; payload: unknown };
  agents: unknown[];
}

// One player's points in a game of a match, by member key, with the game's own detail of where
// they came from, which the match's table shows.
export interface MatchScore {
  key: string;
  points: number;
  detail: unknown;
}

// What a game needs to be played as a match (docs/architecture.md#matches). The room keeps the
// match: the number of games, the totals and the ranking. The game decides how its players are
// grouped from one game to the next, and how each of them scores.
export interface MatchHooks<Data> {
  // A match begins with these rules, or the room stops being one, with null. The game forgets
  // whatever it remembered of an earlier match.
  setup(data: Data, ctx: GameContext, rules: MatchRules | null): Data;
  // Each player's points in the current game as they stand, the game's end included once it has
  // ended, or null for a game that counts for nothing, as one that the chair withdrew. Everyone
  // who played for a side is in it, also with no points.
  score(data: Data, ctx: GameContext): MatchScore[] | null;
  // The players who play in the game, by player ID, which the match lists from its start.
  lineup(data: Data): string[];
}

export interface GameModule<Data = unknown, View = unknown> {
  id: string;
  // How many words a game needs from the word library.
  wordsNeeded: number;
  // Whether two words must not be in the same game, such as two of which one contains the other.
  // The room draws words of which no two clash, as far as its fields let it.
  wordsClash?(a: BoardWord, b: BoardWord): boolean;
  // A new room's data, with the game's default settings for the room's language.
  create(language: Language): Data;
  // The chair sets the game's own settings, when creating the room and later in the waiting room,
  // where the room calls this. The settings are as the chair's message carried them, so the module
  // checks them all and refuses them with bad_settings when it can't take them. Settings that
  // change nothing give the data back as it is.
  configure(data: Data, ctx: GameContext, settings: unknown): GameUpdate<Data>;
  // The game's own settings, as the room plays by them: whole, and checked, as configure() took
  // them. The server keeps them with how the room was set up (RoomSetup); for a module without
  // this, it keeps the settings as the chair's message carried them.
  settingsOf?(data: Data): unknown;
  // A newcomer, who has come to play or only to watch. The game decides what that means, such as
  // a seat in a group; the context already knows the newcomer's member key.
  join(data: Data, ctx: GameContext, playerId: string, play: boolean): Data;
  leave(data: Data, playerId: string): Data;
  // The chair takes a player out of play, for instance to free a seat.
  bench(data: Data, ctx: GameContext, playerId: string): Data;
  // The chair's "shuffle the groups", or whatever the game makes of it.
  shuffle(data: Data, ctx: GameContext): Data;
  // Whether a game can start. What still keeps it from starting is for the module's view to
  // say, in its own words; the room only needs the answer.
  canStart(data: Data, ctx: GameContext): boolean;
  // The words come with their terms in the other languages of the word library.
  start(data: Data, ctx: GameContext, words: BoardWord[], gameId: string): Data;
  // When the game next has something to do by itself, without anyone's message, such as ending a
  // turn whose time has run out: a reading of the room's clock (GameContext.now), or null for
  // never. The room asks after every change to the data, and calls tick() once that time comes.
  deadline(data: Data): number | null;
  // Does what is due by now, and gives the data back as it is when nothing is. The room calls this
  // at the deadline, and also before each of the game's messages, so that a message which arrives
  // after a deadline finds what the deadline brought, however late the timer is.
  tick(data: Data, ctx: GameContext): Data;
  // Whether the game has ended by itself. The room asks after every change to the data during a
  // game, whatever made it: one of the game's messages, or a player who left or was benched.
  isOver(data: Data): boolean;
  // The chair ends the game early. The withdrawal names the game it is meant for, and the game
  // refuses one for another game or one that comes after it has ended. The room passes that
  // refusal on as it is, so the chair reads the game's own codes, such as game_over.
  withdraw(data: Data, gameId: string): GameUpdate<Data>;
  // Back to the waiting room after a game, with everyone in their seats, or, in a match, seated for
  // its next game as its rules say.
  again(data: Data, ctx: GameContext): Data;
  // The game's own messages, such as "keywords:reveal". Must not await anything, so that no
  // other message can run between reading the data and writing it.
  handle(data: Data, ctx: GameContext, playerId: string, type: string, payload: unknown): GameUpdate<Data>;
  // How each player who took part did in the game that has just ended, for the records of players
  // with accounts, or null when the game counts for no record, as one that the chair withdrew.
  // Whoever only watched takes no part. The room asks once, when the game has ended.
  results?(data: Data, ctx: GameContext): PlayerResult[] | null;
  // The game that has just ended, as something to watch again (docs/architecture.md#replays):
  // whatever the game's own replay viewer takes, as JSON, or null when the game is nothing to
  // keep, as one that the chair withdrew. The room asks once, when the game has ended and a
  // player with an account took part.
  replay?(data: Data, ctx: GameContext): unknown;
  // A kept replay as an account opens it (docs/architecture.md#replays): with the groups and who
  // everyone in them was, the accounts as they are now and the deleted ones as deleted, worked out
  // from the record of the game for a replay from before the groups were kept. Without this, the
  // replay goes as it was kept.
  showReplay?(kept: KeptReplay): unknown;
  // A guest's seat has become an account's (docs/architecture.md#accounts): the member `playerId`
  // is known by the member key `to` instead of `from` from now on, and whatever the game remembers
  // by the old key, it remembers by the new one. The seat stands, and what the game knows of the
  // two keys goes together under the new one.
  rekey?(data: Data, playerId: string, from: string, to: string): Data;
  // A game that can be played as a match.
  match?: MatchHooks<Data>;
  // For the log of the game (docs/architecture.md#game-records), which the room keeps from the
  // start of a game to its end, and the record of who played in it. Where a member is in the
  // game, as the game describes it, such as the group and the role they have: the room asks about
  // everyone right after start(), for how the game began, and about whoever comes during the game,
  // since the game may seat them. Without this, the log says nothing of where anyone is.
  seated?(data: Data, playerId: string): unknown;
  // How the game that has just started began, for its log: what it takes, with the moves in the
  // log, to play the game through again, such as the board with every color, and the settings.
  // The log stays on the server. Without this, the log says nothing of it.
  setup?(data: Data): unknown;
  // What the log keeps of one of the game's messages that changed the game, with the payload as
  // the message carried it, or null to keep nothing of it, as of a card chosen and chosen again.
  // Without this, the log keeps the message's type alone.
  logged?(type: string, payload: unknown): LogNote | null;
  // What else the log keeps of a change in the game, besides the message, the timer or the room's
  // event that brought it, as entries of the game's own, in order: such as where things stood when
  // a turn ended. `before` and `after` are the data on either side of the change. Without this,
  // nothing else.
  logChanges?(before: Data, after: Data): GameLogNote[];
  // Whether a member may send a quick reaction now (Room.emote). Without this, always; a game that
  // says no for a while, as a game of keywords does to whoever has seen the key while the students
  // guess, has the room refuse with emote_not_now.
  mayEmote?(data: Data, playerId: string, ctx: GameContext): boolean;
  // The players the game is waiting for now, by player ID, such as the group's PI while a clue is
  // due: when a timer changes the game, the log names those of them who were offline then. Without
  // this, it names nobody.
  due?(data: Data): string[];
  // How the game that has just finished came out, for its record: who won and how, or null when
  // the game can't say. Without this, the record says how the game ended and nothing of who won.
  outcome?(data: Data): GameOutcome | null;
  // What an AI player did in the game that has just finished, for its page; without this, its
  // page counts its games alone.
  agentFeats?(data: Data, playerId: string): AgentFeats;
  // The version of the game's rules and scoring, which goes on the record of every game, so that a
  // game played under other rules can be told apart. It goes up by one whenever they change.
  rulesVersion?: number;
  // The member keys of everyone who has played in the current game, those who have left it
  // included: the players whose part in it the record keeps. Without this, those whom results()
  // names.
  participants?(data: Data, ctx: GameContext): string[];
  // AI players (docs/architecture.md#ai-players); a game without these has none. The chair seats a
  // new AI player at the seat that the chair's message names, as the game reads it, or the game
  // refuses with one of its codes, as for a seat that is taken. The context already knows the
  // newcomer's member key and persona.
  seatAgent?(data: Data, ctx: GameContext, playerId: string, seat: unknown): GameUpdate<Data>;
  // A practice room (docs/architecture.md#practice-rooms): where its creator sits for the role they
  // chose, as the game names its roles, and where the AI players sit who take the other seats. Null
  // for a role that the game doesn't have. A game without this has no practice rooms.
  practice?(role: string): PracticeSeats | null;
  // What a seat is to do now when an AI plays it: an AI player's own seat, or the seat of a player
  // who is offline in their turn. Null when there is nothing for it to do. The context's isOnline
  // says who is there to play, which counts a person who has been offline for a short while as
  // there still (server/src/core/agents.ts).
  agentTask?(data: Data, ctx: GameContext, playerId: string): AgentTask | null;
  // The next message that the agent's answer to a task makes for the seat, with the game as it is
  // now, or null when the answer has nothing more to give. `made` are the types of the messages
  // sent for the task so far, in order. Each move goes through handle() as a player's would, so a
  // move that the game has meanwhile made impossible is refused there; the room then stops the task.
  agentMove?(
    data: Data,
    ctx: GameContext,
    playerId: string,
    task: AgentTask,
    answer: AgentAnswer,
    made: readonly string[],
  ): AgentMove | null;
  // The game's part of the room view, as a function of the viewer. The only way a game's data
  // leaves the server. The room asks once for a snapshot and calls the function for each member
  // and for the screens, so a module builds what everyone sees once, and filters it for each.
  views(data: Data, ctx: GameContext): (viewer: Viewer) => View;
}
