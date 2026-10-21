import type { RoomView } from '@reviewer2/shared';
import type { ImpostorRoomData, ImpostorView, SeatView } from '@reviewer2/shared/impostor';
import { computed, type Ref } from 'vue';
import type { ShownPlayer, ShownRoom } from '../../core/room';
import { act } from '../../core/socket';

// What the hidden word game's screens need to know about the room, worked out once: the game's own
// part of the view, the game being played, if any, whether the viewer chairs the room and sets the
// words, who plays the next game, in the order they came, and who watches.
export function useImpostor(room: Ref<ShownRoom | RoomView>) {
  const data = computed(() => room.value.data as ImpostorRoomData);
  const game = computed<ImpostorView | null>(() => data.value.game);
  const isChair = computed(() => room.value.me !== null && room.value.chairId === room.value.me);
  // The setter is whoever chairs the waiting room, while the room has one, and in a game whoever set
  // its words, though the chair may have passed on since (docs/games/impostor.md#the-setter).
  const setterId = computed(() =>
    game.value ? game.value.setter : data.value.settings.setter ? room.value.chairId : null,
  );
  const isSetter = computed(() => setterId.value !== null && setterId.value === room.value.me);
  const players = computed<ShownPlayer[]>(() => room.value.players);
  const seated = computed(() =>
    data.value.seats.flatMap((id) => {
      const player = players.value.find((other) => other.id === id);
      return player && id !== setterId.value ? [player] : [];
    }),
  );
  const spectators = computed(() =>
    players.value.filter((player) => !data.value.seats.includes(player.id) && player.id !== setterId.value),
  );
  const isSeated = computed(() => room.value.me !== null && data.value.seats.includes(room.value.me));
  const sit = (play: boolean) => act('impostor:seat', { play });
  return { data, game, isChair, setterId, isSetter, seated, spectators, isSeated, sit };
}

// The player behind a seat, where the viewer may know who it is: in a game that isn't anonymous,
// once the game is over, or the viewer's own seat; undefined for one who has left the room.
export const playerAt = (seat: SeatView, players: readonly ShownPlayer[]): ShownPlayer | undefined =>
  seat.playerId === null ? undefined : players.find((player) => player.id === seat.playerId);
