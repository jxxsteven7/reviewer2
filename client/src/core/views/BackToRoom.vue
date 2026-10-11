<script setup lang="ts">
import { formatCode, type RoomView, type SeatedRoom } from '@reviewer2/shared';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { connect, send, socket } from '../socket';

// The rooms where this browser, or its account on any device, still has a seat, each with the way
// back (meta:seats). They are asked for once the page is connected and again after every
// reconnect, since a seat may have gone meanwhile. Nobody is taken back without asking.
//
// A connection that came from a room's page is still in that room, and hears of it: a snapshot
// says whether a game is on, and when the room closes or the player is removed, which the server
// says without naming the room, the seats are asked for again.
const { t } = useI18n();
const seats = ref<SeatedRoom[]>([]);

async function load() {
  const reply = await send<{ seats: SeatedRoom[] }>('meta:seats');
  if (reply.ok) seats.value = reply.seats;
}

const ask = () => void load();
const follow = (view: RoomView) => {
  seats.value = seats.value.map((seat) =>
    seat.code === view.code ? { ...seat, playing: view.phase !== 'lobby' } : seat,
  );
};
onMounted(() => {
  socket.on('connect', ask);
  socket.on('room:closed', ask);
  socket.on('room:state', follow);
  if (socket.connected) ask();
  else connect();
});
onBeforeUnmount(() => {
  socket.off('connect', ask);
  socket.off('room:closed', ask);
  socket.off('room:state', follow);
});
</script>

<template>
  <ul v-if="seats.length > 0" class="seats">
    <li v-for="seat in seats" :key="seat.code" class="seat">
      <p>{{ t(seat.playing ? 'home.seats.playing' : 'home.seats.waiting', { code: formatCode(seat.code) }) }}</p>
      <RouterLink :to="`/room/${seat.code}`" class="back">{{ t('home.seats.back') }}</RouterLink>
    </li>
  </ul>
</template>

<style scoped>
.seats {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: var(--space-2) 0 0;
  padding: 0;
  list-style: none;
}

.seat {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--paper);
  box-shadow: var(--shadow-1);
  font-weight: var(--weight-bold);
}

.back {
  display: inline-flex;
  flex: none;
  align-items: center;
  min-height: 44px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-pill);
  background: var(--ink);
  color: var(--on-ink);
  font-weight: var(--weight-black);
  text-decoration: none;
}
</style>
