<script setup lang="ts">
import { computed, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import ConnectionBanner from '../components/ConnectionBanner.vue';
import EmoteBubbles from '../components/EmoteBubbles.vue';
import ManuscriptId from '../components/ManuscriptId.vue';
import PageMasthead from '../components/PageMasthead.vue';
import RoomNotice from '../components/RoomNotice.vue';
import SoundToggle from '../components/SoundToggle.vue';
import { muted, unlocked } from '../sound';
import { useRoomPage } from '../useRoomPage';

// /room/:code/screen: the room for a projector or a shared screen. It watches without a seat and
// gets the spectators' view, so it never shows the key. It shows and plays the quick reactions,
// once someone has clicked it, which it asks for until then, and has a switch to keep them quiet.
const props = defineProps<{ code: string }>();
const { t } = useI18n();
const { room, entry, screens } = useRoomPage(toRef(props, 'code'), { screen: true });
const soundLocked = computed(() => !muted.value && !unlocked.value);
</script>

<template>
  <ConnectionBanner />
  <EmoteBubbles large />
  <div class="screen-page">
    <PageMasthead>
      <p v-if="room && soundLocked" class="sound-hint">{{ t('emotes.locked') }}</p>
      <SoundToggle v-if="room" />
      <ManuscriptId v-if="room" :code="room.code" />
    </PageMasthead>
    <main>
      <component :is="screens.Screen" v-if="entry.status === 'in' && room && screens" :room="room" />
      <RoomNotice v-else screen />
    </main>
  </div>
</template>

<style scoped>
.screen-page {
  min-height: 100vh;
  min-height: 100dvh;
  padding: 0 var(--space-5) var(--space-5);
}

.sound-hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}
</style>
