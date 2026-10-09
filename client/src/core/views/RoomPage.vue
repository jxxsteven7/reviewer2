<script setup lang="ts">
import { computed, toRef } from 'vue';
import ConnectionBanner from '../components/ConnectionBanner.vue';
import EmoteBubbles from '../components/EmoteBubbles.vue';
import ManuscriptId from '../components/ManuscriptId.vue';
import PageMasthead from '../components/PageMasthead.vue';
import RoomNotice from '../components/RoomNotice.vue';
import { useRoomPage } from '../useRoomPage';
import NameForm from './NameForm.vue';
import RoomMenu from './RoomMenu.vue';

// /room/:code. Enters the room, asks a newcomer for a name, and then shows the room's game, with
// the room menu in the masthead. The whole page is in the room's language for as long as it is
// open.
const props = defineProps<{ code: string }>();
const { room, entry, screens } = useRoomPage(toRef(props, 'code'));
const me = computed(() => room.value?.players.find((player) => player.id === room.value?.me));
</script>

<template>
  <ConnectionBanner />
  <EmoteBubbles />
  <div class="page room-page">
    <PageMasthead>
      <ManuscriptId v-if="room" :code="room.code" />
      <RoomMenu v-if="entry.status === 'in' && room && me" :room="room" :me="me" />
    </PageMasthead>

    <main>
      <template v-if="entry.status === 'in' && room && screens">
        <component :is="room.phase === 'lobby' ? screens.Lobby : screens.Game" :room="room" />
      </template>
      <NameForm v-else-if="entry.status === 'needs_name'" :code="code" />
      <RoomNotice v-else />
    </main>
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
/* On a narrow screen the masthead has room for the room's number and menu beside the tile, but
   not for the name. */
@media (max-width: 39.99rem) {
  .room-page :deep(.wordmark .name) {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
}
</style>
