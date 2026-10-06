import type { BoardWord, Language, RoomPhase } from '@reviewer2/shared';
import type { Rng } from './random';

// What the shared layer needs from a game (docs/architecture.md). The shared layer runs rooms,
// players, connections and the chair's controls; a game module owns its seats, its rules and what
// each player may see. Modules keep their data immutable: every call returns new data.

export interface GameContext {
  phase: RoomPhase;
  language: Language;
  rng: Rng;
  // A player's member key, which stays the same when they leave and come back.
  keyOf(playerId: string): string;
  isOnline(playerId: string): boolean;
  // Everyone in the room, in the order they joined.
  playerIds(): string[];
}

// Who is looking: a member of the room, or a screen that only watches.
export type Viewer = { playerId: string } | { screen: true };

export type GameResult<Data> = { ok: true; data: Data } | { ok: false; error: string };

export interface GameModule<Data = unknown, View = unknown> {
  id: string;
  // How many words a game needs from the word library.
  wordsNeeded: number;
  create(): Data;
  join(data: Data, playerId: string): Data;
  leave(data: Data, playerId: string): Data;
  // The chair takes a player out of play, for instance to free a seat.
  bench(data: Data, ctx: GameContext, playerId: string): Data;
  // The chair's "shuffle the groups", or whatever the game makes of it.
  shuffle(data: Data, ctx: GameContext): Data;
  // Why the game can't start yet, as error codes; empty when it can.
  startProblems(data: Data, ctx: GameContext): string[];
  // The words come with their terms in the other languages of the word library.
  start(data: Data, ctx: GameContext, words: BoardWord[], gameId: string): Data;
  // Whether the game has ended by itself. The room asks after every change to the data during a
  // game, whatever made it: one of the game's messages, or a player who left or was benched.
  isOver(data: Data): boolean;
  // The chair ends the game early. The withdrawal names the game it is meant for, and the game
  // refuses one for another game or one that comes after it has ended.
  withdraw(data: Data, gameId: string): GameResult<Data>;
  // Back to the waiting room after a game, with everyone in their seats.
  again(data: Data): Data;
  // The game's own messages, such as "keywords:reveal". Must not await anything, so that no
  // other message can run between reading the data and writing it.
  handle(data: Data, ctx: GameContext, playerId: string, type: string, payload: unknown): GameResult<Data>;
  // The game's part of the room view, filtered for this viewer. The only way a game's data
  // leaves the server.
  view(data: Data, ctx: GameContext, viewer: Viewer): View;
}
