<script setup lang="ts">
import type { RoomView } from '@reviewer2/shared';
import { toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from '../../core/components/UiButton.vue';
import { act } from '../../core/socket';
import { useKeywords } from './useKeywords';

// The game in progress. The board, the clues and the result come in the next change; until
// then, this only says that the game has started or is over, and lets the chair end it or go
// back to the waiting room, so that a room is never stuck in a game.
const props = defineProps<{ room: RoomView }>();
const { t } = useI18n();
const { isChair } = useKeywords(toRef(props, 'room'));
</script>

<template>
  <section class="game">
    <p class="kicker">{{ t('home.games.keywords.name') }}</p>
    <p>{{ t(room.phase === 'ended' ? 'game.ended' : 'game.started') }}</p>
    <div v-if="isChair" class="actions">
      <UiButton v-if="room.phase === 'ended'" @click="act('room:again', { gameId: room.gameId })">
        {{ t('game.again') }}
      </UiButton>
      <UiButton v-else variant="danger" @click="act('room:end', { gameId: room.gameId })">{{ t('game.end') }}</UiButton>
    </div>
  </section>
</template>

<style scoped>
.game {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-6) 0;
}
</style>
