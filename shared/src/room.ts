import type { Language } from './language';

// What every member of a room sees of it. The game's own part, such as seats and the board, is
// in `data`; the server builds it for each viewer separately (docs/architecture.md).

export type RoomPhase = 'lobby' | 'playing' | 'ended';

export interface PlayerView {
  id: string;
  name: string;
  online: boolean;
  // The address of the avatar that a player with an account uploaded. Without it, the client
  // draws the default avatar from the name.
  avatar?: string;
}

// Who chairs the room when the chair has gone: the first to have joined among those online, or
// else among everyone, in the order of `players`, which is the order they joined in. Nobody when
// there is no one. The server hands the chair over with this, and the chair's leave sheet names
// whom it will be, so the two can't drift apart.
export function nextChair(players: readonly Pick<PlayerView, 'id' | 'online'>[]): string | null {
  return (players.find((player) => player.online) ?? players[0])?.id ?? null;
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
  // How many games this room has started. A start gives the number it saw, so that one that
  // comes late or twice can't start a game that nobody asked for.
  round: number;
  // The game that is being played or has just ended, and null in the waiting room. The chair's
  // messages about a game name it, so that a late one can't land in the next game.
  gameId: string | null;
  chairId: string | null;
  players: PlayerView[];
  // How many screens are watching. They have no name and no seat, so this number is all that
  // anyone sees of them; the chair can send them all away.
  screens: number;
  // The viewer's own player ID, or null for a screen, which watches without playing.
  me: string | null;
  // The game's own part of the view, built for this viewer alone.
  data: Game;
}
