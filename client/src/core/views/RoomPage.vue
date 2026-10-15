<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ConnectionBanner from '../components/ConnectionBanner.vue';
import EmoteBubbles from '../components/EmoteBubbles.vue';
import ManuscriptId from '../components/ManuscriptId.vue';
import PageMasthead from '../components/PageMasthead.vue';
import PlayerPanel from '../components/PlayerPanel.vue';
import RoomNotice from '../components/RoomNotice.vue';
import { provideOpenPlayer } from '../playerPanel';
import { reconnecting } from '../socket';
import { ROOM_ACTIONS, useRoomPage } from '../useRoomPage';
import JoinForm from './JoinForm.vue';
import RoomMenu from './RoomMenu.vue';

// /room/:code. Enters the room, with the invitation that a friend sent when the address carries one
// as `invite`, asks a newcomer whether they play, and then shows the room's game, with the room menu
// in the masthead. In the waiting room the masthead stays at the top of the screen, with the
// reaction button, which the waiting room puts there (ROOM_ACTIONS), left of the room menu; in a
// game it scrolls away, and the game keeps its own bar at the top. The whole page is in the room's
// language for as long as it is open. A tap on a player's avatar anywhere on the page opens the
// player's panel (PlayerPanel.vue).
const props = defineProps<{ code: string }>();
const route = useRoute();
const router = useRouter();
const invitation = computed(() => (typeof route.query.invite === 'string' ? route.query.invite : undefined));
const { room, entry, screens } = useRoomPage(toRef(props, 'code'), { invitation });
const me = computed(() => room.value?.players.find((player) => player.id === room.value?.me));
const opened = ref<string | null>(null);
provideOpenPlayer((playerId) => (opened.value = playerId));

// The invitation has done its work once the page is in the room, whether it brought the page in or
// came while the page was in already. It leaves the address, so that a reload comes back as a
// member, by the code, rather than ask with an invitation that has lapsed.
watch(
  [() => entry.status, invitation],
  ([status, invite]) => {
    if (status === 'in' && invite !== undefined) void router.replace({ path: route.path });
  },
  { immediate: true },
);

// The waiting room and the game are pages of their own to the eye: when the room goes from one to
// the other, as when the chair starts the game from the foot of the desk, the new one opens at its
// top, rather than where the old one was scrolled to.
const inLobby = computed(() => (room.value ? room.value.phase === 'lobby' : null));
// The masthead stays at the top of the screen in the waiting room.
const pinned = computed(() => entry.status === 'in' && inLobby.value === true);
watch(
  inLobby,
  (now, before) => {
    if (now !== null && before !== null && now !== before) window.scrollTo({ top: 0, behavior: 'instant' });
  },
  { flush: 'post' },
);
</script>

<template>
  <ConnectionBanner />
  <EmoteBubbles />
  <div class="page room-page">
    <PageMasthead compact :pinned="pinned" :class="{ 'below-banner': pinned && reconnecting }">
      <ManuscriptId v-if="room" :code="room.code" :tight="pinned" />
      <span :id="ROOM_ACTIONS" class="room-actions"></span>
      <RoomMenu v-if="entry.status === 'in' && room && me" :room="room" :me="me" />
    </PageMasthead>

    <main>
      <template v-if="entry.status === 'in' && room && screens">
        <component :is="room.phase === 'lobby' ? screens.Lobby : screens.Game" :room="room" />
      </template>
      <JoinForm v-else-if="entry.status === 'needs_choice'" :code="code" />
      <RoomNotice v-else />
    </main>
    <PlayerPanel v-if="entry.status === 'in' && room" :player-id="opened" :room="room" @close="opened = null" />
  </div>
</template>

<style scoped>
.room-page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
  max-width: var(--page-wide);
}

main {
  flex: 1;
}

/* What the waiting room puts there stands in the masthead's row as its own. */
.room-actions {
  display: contents;
}
</style>
