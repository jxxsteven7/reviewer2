import type { Language } from './language';

// What every member of a room sees of it. The game's own part, such as seats and the board, is
// in `game`; the server builds it for each viewer separately (docs/architecture.md).

export type RoomPhase = 'lobby' | 'playing' | 'ended';

export interface PlayerView {
  id: string;
  name: string;
  online: boolean;
}

export interface RoomView<Game = unknown> {
  // A new random ID for every room, so that a code that is used again later never mixes two rooms up.
  roomId: string;
  code: string;
  // Goes up with every change. A client keeps the snapshot with the highest rev for its roomId.
  rev: number;
  game: string;
  language: Language;
  fields: string[];
  phase: RoomPhase;
  chairId: string | null;
  players: PlayerView[];
  // The viewer's own player ID, or null for a screen, which watches without playing.
  me: string | null;
  data: Game;
}
