import {
  SPECTATOR,
  TEAMS,
  type KeywordsRoomData,
  type PlayerView,
  type RoomView,
  type Seat,
  type Team,
} from '@reviewer2/shared';
import { computed, type Ref } from 'vue';
import { act } from '../../core/socket';

// What the game's screens need to know about the room, worked out once.
export function useKeywords(room: Ref<RoomView>) {
  const data = computed(() => room.value.data as KeywordsRoomData);
  const seatOf = (id: string): Seat => data.value.seats[id] ?? SPECTATOR;
  const players = computed(() => room.value.players);
  const mySeat = computed(() => (room.value.me === null ? null : seatOf(room.value.me)));
  const isChair = computed(() => room.value.me !== null && room.value.chairId === room.value.me);
  const isKeyViewer = computed(() => room.value.me !== null && data.value.keyViewers.includes(room.value.me));

  const inSeat = (team: Team | null, role: Seat['role']): PlayerView[] =>
    players.value.filter((player) => {
      const seat = seatOf(player.id);
      return seat.team === team && seat.role === role;
    });

  const groups = computed(() =>
    TEAMS.map((team) => ({
      team,
      captain: inSeat(team, 'captain')[0] ?? null,
      guessers: inSeat(team, 'guesser'),
    })),
  );
  const spectators = computed(() => inSeat(null, 'spectator'));

  const sit = (team: Team | null, role: Seat['role']) => act('keywords:seat', { team, role });

  return { data, mySeat, isChair, isKeyViewer, groups, spectators, sit };
}
