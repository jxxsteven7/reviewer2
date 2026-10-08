<script setup lang="ts">
import { computed, toRef } from 'vue';
import ConnectionBanner from '../components/ConnectionBanner.vue';
import ManuscriptId from '../components/ManuscriptId.vue';
import PageMasthead from '../components/PageMasthead.vue';
import RoomNotice from '../components/RoomNotice.vue';
import { useRoomPage } from '../useRoomPage';
import NameForm from './NameForm.vue';
import RoomFooter from './RoomFooter.vue';

// /room/:code. Enters the room, asks a newcomer for a name, and then shows the room's game. The
// whole page is in the room's language for as long as it is open.
const props = defineProps<{ code: string }>();
const { room, entry, screens } = useRoomPage(toRef(props, 'code'));
const me = computed(() => room.value?.players.find((player) => player.id === room.value?.me));
</script>

<template>
  <ConnectionBanner />
  <div class="page room-page">
    <PageMasthead>
      <ManuscriptId v-if="room" :code="room.code" />
    </PageMasthead>

    <main>
      <template v-if="entry.status === 'in' && room && screens">
        <component :is="room.phase === 'lobby' ? screens.Lobby : screens.Game" :room="room" />
      </template>
      <NameForm v-else-if="entry.status === 'needs_name'" :code="code" />
      <RoomNotice v-else />
    </main>

    <RoomFooter v-if="entry.status === 'in' && room && me" :room="room" :me="me" />
  </div>
</template>

<style scoped>
.room-page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
  max-width: 64rem;
}

main {
  flex: 1;
}
</style>
