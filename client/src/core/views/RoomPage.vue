<script setup lang="ts">
import { computed, toRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ConnectionBanner from '../components/ConnectionBanner.vue';
import EmoteBubbles from '../components/EmoteBubbles.vue';
import ManuscriptId from '../components/ManuscriptId.vue';
import PageMasthead from '../components/PageMasthead.vue';
import RoomNotice from '../components/RoomNotice.vue';
import { useRoomPage } from '../useRoomPage';
import NameForm from './NameForm.vue';
import RoomMenu from './RoomMenu.vue';

// /room/:code. Enters the room, with the invitation that a friend sent when the address carries one
// as `invite`, asks a newcomer for a name, and then shows the room's game, with the room menu in the
// masthead. The whole page is in the room's language for as long as it is open.
const props = defineProps<{ code: string }>();
const route = useRoute();
const router = useRouter();
const invitation = computed(() => (typeof route.query.invite === 'string' ? route.query.invite : undefined));
const { room, entry, screens } = useRoomPage(toRef(props, 'code'), { invitation });
const me = computed(() => room.value?.players.find((player) => player.id === room.value?.me));

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
</script>

<template>
  <ConnectionBanner />
  <EmoteBubbles />
  <div class="page room-page">
    <PageMasthead compact>
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
</style>
