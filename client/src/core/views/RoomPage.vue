<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { games } from '../../games';
import ConnectionBanner from '../components/ConnectionBanner.vue';
import ManuscriptId from '../components/ManuscriptId.vue';
import PageMasthead from '../components/PageMasthead.vue';
import RoomNotice from '../components/RoomNotice.vue';
import { errorKey } from '../errors';
import { browserLanguage, setLanguage, storedLanguage } from '../i18n';
import { closeRoomPage, entry, openRoom, room } from '../room';
import NameForm from './NameForm.vue';
import RoomFooter from './RoomFooter.vue';

// /room/:code. Enters the room, asks a newcomer for a name, and then shows the room's game. The
// whole page is in the room's language for as long as it is open.
const props = defineProps<{ code: string }>();
const { t } = useI18n();

watch(
  () => props.code,
  (code) => openRoom(code),
  { immediate: true },
);

watch(
  () => room.value?.language ?? entry.language,
  (language) => {
    if (language) setLanguage(language, { remember: false });
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  closeRoomPage();
  setLanguage(storedLanguage() ?? browserLanguage(), { remember: false });
});

const screens = computed(() => (room.value ? games[room.value.game] : undefined));
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
      <RoomNotice
        v-else-if="entry.status === 'not_found'"
        :title="t('room.notFound.title')"
        :body="t('room.notFound.body')"
      />
      <RoomNotice v-else-if="entry.status === 'closed'" :body="t(`room.closed.${entry.closed ?? 'expired'}`)" />
      <RoomNotice v-else-if="entry.status === 'failed'" :body="t(errorKey(entry.error ?? 'unknown'))" />
      <p v-else class="loading">{{ t('room.joining') }}</p>
    </main>

    <RoomFooter v-if="entry.status === 'in' && me" :me="me" />
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

.loading {
  padding: var(--space-7) 0;
  color: var(--ink-3);
}
</style>
