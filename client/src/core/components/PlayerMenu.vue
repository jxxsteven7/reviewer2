<script setup lang="ts">
import type { PlayerView } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import { act } from '../socket';
import { useBusy } from '../useBusy';
import UiButton from './UiButton.vue';
import UiSheet from './UiSheet.vue';

// The chair's actions for one player: move them to the spectators, remove them, or hand them
// the chair.
const props = defineProps<{ player: PlayerView | null }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const { busy, run } = useBusy();

async function manage(message: 'room:spectate' | 'room:remove' | 'room:chair') {
  const player = props.player;
  if (!player) return;
  await run(() => act(message, { playerId: player.id }));
  emit('close');
}
</script>

<template>
  <UiSheet :open="player !== null" :title="player?.name ?? ''" @close="emit('close')">
    <div class="actions">
      <UiButton :disabled="busy" @click="manage('room:spectate')">{{ t('lobby.manage.spectate') }}</UiButton>
      <UiButton :disabled="busy" @click="manage('room:chair')">{{ t('lobby.manage.chair') }}</UiButton>
      <UiButton variant="danger" :disabled="busy" @click="manage('room:remove')">
        {{ t('lobby.manage.remove') }}
      </UiButton>
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
