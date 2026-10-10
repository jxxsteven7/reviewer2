import type { Ack, BoardWord, Language, MatchRules, RoomPhase } from '@reviewer2/shared';
import type { Rng } from './random';

// What the shared layer needs from a game (docs/architecture.md). The shared layer runs rooms,
// players, connections and the chair's controls; a game module owns its seats, its rules and what
// each player may see. Modules keep their data immutable: every call returns new data.

export interface GameContext {
  phase: RoomPhase;
  language: Language;
  rng: Rng;
  // The room's clock, in milliseconds. It only runs forward, and only differences between its
  // readings mean anything.
  now(): number;
  // A player's member key, which stays the same when they leave and come back. The room also
  // knows the keys of those who have left during the current game.
  keyOf(playerId: string): string;
  isOnline(playerId: string): boolean;
  // Everyone in the room, in the order they joined.
  playerIds(): string[];
}

// Who is looking: a member of the room, or a screen that only watches.
export type Viewer = { playerId: string } | { screen: true };

// What a module answers when it is asked to change its data: the new data, or a refusal with one
// of the game's error codes.
export type GameUpdate<Data> = Ack<{ data: Data }>;

// One player's part in a game that has ended, as the game describes it, for the record of a player
// with an account: which side they played for and in what role, which side won, whether they did,
// and the game's own word for how it went, such as the verdict of a decision letter.
export interface PlayerResult {
  playerId: string;
  side: string;
  role: string;
  winner: string;
  won: boolean;
  verdict: string;
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
  // A new room's data, with the game's default settings for the room's language.
  create(language: Language): Data;
  // The chair sets the game's own settings, when creating the room and later in the waiting room,
  // where the room calls this. The settings are as the chair's message carried them, so the module
  // checks them all and refuses them with bad_settings when it can't take them. Settings that
  // change nothing give the data back as it is.
  configure(data: Data, ctx: GameContext, settings: unknown): GameUpdate<Data>;
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
  // A guest's seat has become an account's (docs/architecture.md#accounts): the member `playerId`
  // is known by the member key `to` instead of `from` from now on, and whatever the game remembers
  // by the old key, it remembers by the new one. The seat stands, and what the game knows of the
  // two keys goes together under the new one.
  rekey?(data: Data, playerId: string, from: string, to: string): Data;
  // A game that can be played as a match.
  match?: MatchHooks<Data>;
  // The game's part of the room view, as a function of the viewer. The only way a game's data
  // leaves the server. The room asks once for a snapshot and calls the function for each member
  // and for the screens, so a module builds what everyone sees once, and filters it for each.
  views(data: Data, ctx: GameContext): (viewer: Viewer) => View;
}
