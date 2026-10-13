import type { PlayerView, RoomView } from '@reviewer2/shared';
import { account } from './account';

// What a room's player panel (components/PlayerPanel.vue) offers its viewer to do with another
// player. The server decides in the end; this only says what to show.

// In a public room, anyone with an account may report a player to the operator
// (docs/architecture.md#public-rooms).
export const mayReport = (room: RoomView): boolean => room.public && account.summary !== null;

// Anyone with an account may ask a player who has one to be friends (docs/architecture.md#friends).
// A rank marks a player with an account; a guest has none.
export const mayBefriend = (room: RoomView, player: PlayerView): boolean =>
  player.id !== room.me && account.summary !== null && player.rank !== undefined;
