import {
  MATCH_TITLES,
  type Ack,
  type ReplayPerson,
  type AgentAnswer,
  type AgentPersona,
  type AgentQuestion,
  type BoardWord,
  type Language,
  type MatchRules,
  type RecordResult,
  type RoomPhase,
  type Title,
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
  // Whether the room is listed for anyone with an account to join (docs/architecture.md#public-rooms),
  // for what a game allows in a private room alone.
  public: boolean;
  // The room's clock, in milliseconds. It only runs forward, and only differences between its
  // readings mean anything.
  now(): number;
  // A player's member key, which stays the same when they leave and come back. The room also
  // knows the keys of those who have left during the current game.
  keyOf(playerId: string): string;
  // An AI player is online while the server's agent answers (docs/architecture.md#ai-players).
  isOnline(playerId: string): boolean;
  // The persona of an AI player, or null for a person.
  agentOf(playerId: string): AgentPersona | null;
  // Everyone in the room, in the order they joined.
  playerIds(): string[];
  // Whether a member, or one who has left during the current game, is logged in to an account,
  // for what a game allows a member with an account alone.
  hasAccount(playerId: string): boolean;
  // Whether the word library has a field, for a game whose players name one, as a setter names the
  // field of their words.
  hasField(field: string): boolean;
  // How many times the account of a player, also of one who has left during the current game, has
  // won a title, as its record has it, or null when there is no count to give: for a guest, who
  // keeps none, in a game that awards none, as one that an AI has played in
  // (docs/architecture.md#ai-players), and when the record can't be read.
  titleCount(playerId: string, title: Title): number | null;
  // Whether the game's titles go to a player, also to one who has left during the current game:
  // to one with an account, where the server keeps accounts, in a game that awards them, which one
  // that an AI has played in doesn't (docs/architecture.md#ai-players).
  awardsTitles(playerId: string): boolean;
}

// An account that played in a game, as a replay shows it: its username, avatar and handle as they
// are when the replay is opened.
export interface ShownAccount {
  username: string;
  avatar: string | null;
  handle: string;
}

// A kept game, as its record keeps it (docs/architecture.md#game-records): how it began
// (GameModule.setup), its log (gameLog.ts) and its language.
export interface KeptGame {
  setup: unknown;
  log: GameLogData;
  language: Language;
}

// A kept game, for an account to watch again (GameModule.showReplay): the accounts that played in it
// as they are now, by the player ID each had, and the IDs that the account watching had in it.
export interface KeptReplay extends KeptGame {
  accounts: ReadonlyMap<string, ShownAccount>;
  viewer: ReadonlySet<string>;
}

// A kept game that finished, counted again (GameModule.recount): with who each player ID was, as
// the room knew them while the game was on (GameContext.keyOf): one key for an account, whichever
// IDs it had in the game, one for a guest, by their number, and one for an AI player.
export interface KeptCount extends KeptGame {
  keyOf(playerId: string): string;
}

// What a kept game that finished counts under the rules of today (GameModule.recount): everyone's
// part in it as it ended, as results() gave it then, by the player ID each had at the end, the
// points of everyone who played for a side, by member key, as the game scores itself
// (GameModule.score), how it came out, as outcome() gave it then, or null for a game that can't
// say, and what the game counts of an AI player in a seat, as agentFeats() gave it then, which a
// game that counts that gives, and one that doesn't never does (store/recount.ts).
export interface Recount {
  results: PlayerResult[];
  scores: MatchScore[];
  outcome: GameOutcome | null;
  feats?(playerId: string): object;
}

// What the rows of a game's data hold in the game's own shape (GameModule.shapes), for the check of
// the data (store/check.ts), which names no game: whether a value is how one of its games began
// (`setup`, as GameModule.setup gives it), the game's settings as a room setup keeps them
// (`settings`, as GameModule.settingsOf gives them), one of the roles that its records name
// (`role`), what a record counts of a player's game (`detail`, as PlayerResult.detail gives it),
// what it counts of an AI player in a seat (`feats`, as GameModule.agentFeats gives it, or null;
// without this, a game counts nothing of them), and a player's guess of who the AI players were
// (`guess`, as GameModule.guessAgents gives it; without this, a game takes no guesses).
export interface GameShapes {
  setup(value: unknown): boolean;
  settings(value: unknown): boolean;
  role(role: string): boolean;
  detail(value: unknown): boolean;
  feats?(value: unknown): boolean;
  guess?(value: unknown): boolean;
}

// How large the log of one of the game's games may grow (gameLog.ts), where the game needs more
// than most, as one in which every player writes something every round does: the whole log, in
// bytes, the part past which it is crowded, the part that what the players say may take up, and how
// many entries each member may add to it apart from what they say (MAX_LOGGED_PER_MEMBER in
// room.ts). What the game leaves out is as gameLog.ts and room.ts have it.
export interface LogLimits {
  bytes?: number;
  crowded?: number;
  said?: number;
  perMember?: number;
}

// Who is looking: a member of the room, or a screen that only watches.
export type Viewer = { playerId: string } | { screen: true };

// What a module answers when it is asked to change its data: the new data, or a refusal with one
// of the game's error codes.
export type GameUpdate<Data> = Ack<{ data: Data }>;

// One player's part in a game that has ended, as the game describes it, for the record of a player
// with an account (docs/architecture.md#game-records): which side they played for, those who win or
// lose together, and in what role; whether they won, drew or lost; their place, 1 and one more for
// each player who did better, so that players level share it; the game's own word for how it went,
// such as the verdict of a decision letter; what the game counts of their game, if anything, in its
// own shape (GameShapes.detail), an object, which the record keeps as JSON, such as where their
// points came from; and the titles that the game brought them, if any. In a game of two sides, the
// winners have place 1 and the others 2; in one where each plays for themselves, each is their own
// side; in one that everyone plays together, all are one side, and win or lose together in place 1.
export interface PlayerResult {
  playerId: string;
  side: string;
  role: string;
  result: RecordResult;
  place: number;
  verdict: string;
  detail?: object;
  titles?: GameTitle[];
}

// How a game that finished came out (docs/architecture.md#game-records), for its record: which side
// won, in the game's own words, or null when no one side did, as when two players share the first
// place or everyone loses together, and how, such as by finding every card of its own or because
// the other side revealed Reviewer 2, so that games can be told apart by it without the replay.
export interface GameOutcome {
  winner: string | null;
  reason: string;
}

// A title that a game brought a player (docs/architecture.md#titles), with the turn of the game it
// came in, or whatever the game counts its moments in, which tells it apart from the same title
// won again later in the game. The record keeps each once.
export interface GameTitle {
  title: Title;
  turn: number;
}

// What the log of a game keeps of one of the game's messages that changed the game
// (docs/architecture.md#game-records): what the message carried, as the game reads it, and, for a
// line of a group's chat, what the player said, which the log keeps apart, so that it can be taken
// out again when their account is deleted. A message that moves the player to another seat rather
// than playing the game says so (`seat`): the room refuses those, with newcomers, once the log of
// the game is crowded with comings and goings (Room.act, gameLog.ts).
export interface LogNote {
  data?: unknown;
  said?: string;
  seat?: true;
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
// grouped from one game to the next; each of them scores as in any game (GameModule.score).
export interface MatchHooks<Data> {
  // The game's own options of a match (MatchRules.options), as the chair's message or a room setup
  // carried them: whole and checked, or null when they won't do, which the room refuses with
  // bad_match. A game without this has none, and takes only rules without options.
  options?(value: unknown): unknown;
  // A match begins with these rules, or the room stops being one, with null. The game forgets
  // whatever it remembered of an earlier match. The rules' options are as options() gave them.
  setup(data: Data, ctx: GameContext, rules: MatchRules | null): Data;
  // The players who play in the game, by player ID, which the match lists from its start.
  lineup(data: Data): string[];
}

export interface GameModule<Data = unknown, View = unknown> {
  id: string;
  // What the game takes from the word library (words/README.md), as the room draws it for each
  // game from the fields that the chair chose: a board of `board` words, of which no two clash
  // (`clash`, such as two of which one contains the other), as far as the fields let it, or one pair
  // of related terms (`pair`), with the IDs of their terms and their field (BoardWord.term). A game
  // without this uses no word library: its rooms have no fields, draw none at random, and take no
  // words of the chair's own, which only a game with a board takes.
  words?: { board: number; clash?(a: BoardWord, b: BoardWord): boolean } | { pair: true };
  // Whether the game that is about to start takes words from the library: a game that may bring its
  // own, as one whose words a setter gives, says no then. Without this, a game with `words` always
  // does.
  drawsWords?(data: Data): boolean;
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
  // A member goes, by themselves or, with `removed`, because the chair removed them, which a game
  // may count against the game, as one that the chair could win by removing others.
  leave(data: Data, ctx: GameContext, playerId: string, removed?: boolean): Data;
  // The chair takes a player out of play, for instance to free a seat.
  bench(data: Data, ctx: GameContext, playerId: string): Data;
  // The chair's "shuffle the groups", or whatever the game makes of it.
  shuffle(data: Data, ctx: GameContext): Data;
  // Whether a game can start. What still keeps it from starting is for the module's view to
  // say, in its own words; the room only needs the answer.
  canStart(data: Data, ctx: GameContext): boolean;
  // The words are those that the room drew (`words`): the board, or the two terms of the pair, in
  // the order of the word library, each with its terms in the other languages of the library. None
  // for a game that takes none, or that said it brings its own this time (drawsWords).
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
  // A kept game as an account watches it again (docs/architecture.md#replays): whatever the game's
  // own replay viewer takes, worked out from how the game began and its log, with who everyone was,
  // the accounts as they are now and the deleted ones as deleted; or null when the log has nothing
  // to watch, as for a game that didn't finish. A game without this has no replays.
  showReplay?(kept: KeptReplay): unknown;
  // A kept game that finished, counted again under the rules of today
  // (docs/architecture.md#game-records): what results() and score() gave at its end, worked
  // out from how the game began and its log, as the replay is, or null when the log doesn't tell,
  // as for a game that didn't finish. The server counts every kept game of the game again when its
  // rules change (store/recount.ts), and the check of the data holds the records against it. A game
  // without this keeps its records as they were counted.
  recount?(kept: KeptCount): Recount | null;
  // The shapes of the game's own in its data, for the check of the data. A game without this has
  // them unchecked.
  shapes?: GameShapes;
  // A guest's seat has become an account's (docs/architecture.md#accounts): the member `playerId`
  // is known by the member key `to` instead of `from` from now on, and whatever the game remembers
  // by the old key, it remembers by the new one. The seat stands, and what the game knows of the
  // two keys goes together under the new one.
  rekey?(data: Data, playerId: string, from: string, to: string): Data;
  // Each player's points in the current game as they stand, the game's end included once it has
  // ended (docs/architecture.md#academic-ranks), or null for a game that counts for nothing, as one
  // that the chair withdrew. Everyone who played for a side is in it, also with no points. A match
  // adds these up. A game without this brings nobody points.
  score?(data: Data, ctx: GameContext): MatchScore[] | null;
  // Whether the game counts for no points, title, streak or friend title, as one that an AI played
  // in doesn't (docs/architecture.md#ai-players), for a reason of the game's own: such as one in
  // which the chair removed a player, which the chair could otherwise win by removing others. The
  // record keeps it in full all the same. Without this, never.
  scoresNothing?(data: Data): boolean;
  // How large the log of one of its games may grow, where the game needs more than gameLog.ts gives.
  logLimits?: LogLimits;
  // The ratings that a player may give a game that finished normally (docs/architecture.md#ratings),
  // such as "good" or "too hard", and whether the game that has just ended is one that may be
  // rated: one that ended by itself as its rules say, and not, say, because a player left it. A
  // game without these has no ratings.
  ratings?: readonly string[];
  rated?(data: Data): boolean;
  // A player's guess of who the AI players were, after a game that had them
  // (docs/architecture.md#guessing-the-ai), as the room's message carried it, or their skip, by
  // null: the data that shows them the answer, with the guess as the record keeps it, in the
  // game's own shape (GameShapes.guess), or a refusal, as from someone who has no guess to make. A
  // game without this takes no guesses.
  guessAgents?(data: Data, ctx: GameContext, playerId: string, guess: unknown): Ack<{ data: Data; guess: unknown }>;
  // Whether the room may be listed for anyone to join with the game as the chair has set it up: a
  // game whose setter needs players who know them, as one with words of a setter, says no. Without
  // this, always.
  mayBePublic?(data: Data): boolean;
  // A game that can be played as a match.
  match?: MatchHooks<Data>;
  // For the log of the game (docs/architecture.md#game-records), which the room keeps from the
  // start of a game to its end, and the record of who played in it. Where a member is in the
  // game, as the game describes it, such as the group and the role they have: the room asks about
  // everyone right after start(), for how the game began, and about whoever comes during the game,
  // since the game may seat them. Without this, the log says nothing of where anyone is.
  seated?(data: Data, playerId: string): unknown;
  // How the game that has just started began, for its record: what it takes, with the moves in the
  // log, to play the game through again, as its replay does (showReplay), such as the board with
  // every color, and the settings. The record stays on the server. Without this, it says nothing
  // of it.
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
  // What an AI player did in the game that has just finished, for its page, in the game's own shape
  // (GameShapes.feats), an object, which the record keeps as JSON, and what it did in all its
  // seats, from what this gave for each, in the order the games ended (agentTotals); without these,
  // its page counts its games alone. A game with this counts the same again (Recount.feats).
  agentFeats?(data: Data, playerId: string): object;
  agentTotals?(feats: readonly unknown[]): unknown;
  // The titles that the game brings (docs/architecture.md#titles), which no other game has: those
  // that results() may give. A match of any game awards the match's titles besides.
  titles?: readonly Title[];
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

// The titles there are (docs/architecture.md#titles): the match's, and those that the games bring.
export const knownTitles = (games: readonly GameModule[]): Title[] => [
  ...MATCH_TITLES,
  ...games.flatMap(({ titles = [] }) => titles),
];

// Who the players of a kept game were, as a replay shows them (docs/architecture.md#replays), by the
// player IDs given: an account that played in it as it is now, and one deleted since as deleted
// (the log's `deleted`); an AI player by its persona, and a guest by their number in the room, as
// the log names them. Someone else, as an account that the log doesn't know any more, is left out.
export function peopleOf(
  log: GameLogData,
  accounts: ReadonlyMap<string, ShownAccount>,
  ids: Iterable<string>,
): Record<string, ReplayPerson> {
  const deleted = new Set(log.deleted);
  const people: Record<string, ReplayPerson> = {};
  for (const id of ids) {
    if (people[id]) continue;
    const account = accounts.get(id);
    const agent = log.agents?.[id];
    const guest = log.guests?.[id];
    if (account) {
      people[id] = {
        name: account.username,
        ...(account.avatar === null ? {} : { avatar: account.avatar }),
        handle: account.handle,
      };
    } else if (deleted.has(id)) {
      people[id] = { deleted: true };
    } else if (agent !== undefined) {
      people[id] = { agent: agent as AgentPersona };
    } else if (guest !== undefined) {
      people[id] = { guest };
    }
  }
  return people;
}
