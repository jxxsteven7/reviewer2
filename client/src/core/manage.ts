import type { PlayerView, RoomView } from '@reviewer2/shared';
import { account } from './account';

// What a page offers its viewer to do with another player, through the player menu
// (components/PlayerMenu.vue). The server decides in the end; this only says what to show.

// In a public room, anyone with an account may report a player to the operator
// (docs/architecture.md#public-rooms).
export const mayReport = (room: RoomView): boolean => room.public && account.summary !== null;

// Whether the viewer has anything to do with a player, which makes the player's name a button
// that opens the menu: the chair has their actions on everyone else, and whoever may report has
// that.
export const mayManage = (room: RoomView, player: PlayerView): boolean =>
  player.id !== room.me && (room.chairId === room.me || mayReport(room));
