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

// /room/:code/screen: the room for a projector or a shared screen. It watches without a seat and
// gets the spectators' view, so it never shows the key.
const props = defineProps<{ code: string }>();
const { t } = useI18n();

watch(
  () => props.code,
  (code) => openRoom(code, { screen: true }),
  { immediate: true },
);

watch(
  () => room.value?.language,
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

// A screen has no seat to lose: when the chair sends the screens away, the ones that belong there
// are put up again from the link.
const closed = computed(() =>
  t(entry.closed === 'removed' ? 'room.screenRemoved' : `room.closed.${entry.closed ?? 'expired'}`),
);
</script>

<template>
  <ConnectionBanner />
  <div class="screen-page">
    <PageMasthead>
      <ManuscriptId v-if="room" :code="room.code" />
    </PageMasthead>
    <main>
      <component :is="screens.Screen" v-if="entry.status === 'in' && room && screens" :room="room" />
      <RoomNotice
        v-else-if="entry.status === 'not_found'"
        :title="t('room.notFound.title')"
        :body="t('room.notFound.body')"
      />
      <RoomNotice v-else-if="entry.status === 'closed'" :body="closed" />
      <RoomNotice v-else-if="entry.status === 'failed'" :body="t(errorKey(entry.error ?? 'unknown'))" />
      <p v-else class="loading">{{ t('room.joining') }}</p>
    </main>
  </div>
</template>

<style scoped>
.screen-page {
  min-height: 100vh;
  min-height: 100dvh;
  padding: 0 var(--space-5) var(--space-5);
}

.loading {
  padding: var(--space-7) 0;
  color: var(--ink-3);
}
</style>
