<script setup lang="ts">
import type { RoomView } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';

// The game in progress. The board, the clues and the result come in the next change; until
// then, this only says that the game has started.
defineProps<{ room: RoomView }>();
const { t } = useI18n();
</script>

<template>
  <section class="game">
    <p class="kicker">{{ t('home.games.keywords.name') }}</p>
    <p>{{ t('game.started') }}</p>
  </section>
</template>

<style scoped>
.game {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-6) 0;
}
</style>
