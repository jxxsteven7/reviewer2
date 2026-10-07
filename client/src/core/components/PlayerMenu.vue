<script setup lang="ts">
import type { PlayerView } from '@reviewer2/shared';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { act } from '../socket';
import UiButton from './UiButton.vue';
import UiSheet from './UiSheet.vue';

// The chair's actions for one player: move them to the spectators, remove them, or hand them
// the chair.
const props = defineProps<{ player: PlayerView | null }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
// While an action is on its way, so that a second tap doesn't send another.
const busy = ref(false);

async function run(message: 'room:spectate' | 'room:remove' | 'room:chair') {
  if (!props.player || busy.value) return;
  busy.value = true;
  await act(message, { playerId: props.player.id });
  busy.value = false;
  emit('close');
}
</script>

<template>
  <UiSheet :open="player !== null" :title="player?.name ?? ''" @close="emit('close')">
    <div class="actions">
      <UiButton :disabled="busy" @click="run('room:spectate')">{{ t('lobby.manage.spectate') }}</UiButton>
      <UiButton :disabled="busy" @click="run('room:chair')">{{ t('lobby.manage.chair') }}</UiButton>
      <UiButton variant="danger" :disabled="busy" @click="run('room:remove')">{{ t('lobby.manage.remove') }}</UiButton>
      <UiButton variant="quiet" @click="emit('close')">{{ t('lobby.manage.cancel') }}</UiButton>
    </div>
  </UiSheet>
</template>

<style scoped>
.actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
</style>
