<script setup lang="ts">
import type { CardView } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import KeywordsCard from './KeywordsCard.vue';

// The 5 by 5 board. Cards can be chosen only when the viewer may reveal one.
defineProps<{ cards: CardView[]; selectable: boolean; selected: number | null; lang: string }>();
const emit = defineEmits<{ select: [index: number] }>();
const { t } = useI18n();
</script>

<template>
  <div class="board" role="group" :aria-label="t('game.board')" :lang="lang">
    <KeywordsCard
      v-for="(card, index) in cards"
      :key="index"
      :card="card"
      :index="index"
      :selectable="selectable && !card.revealed"
      :selected="selected === index"
      @select="emit('select', $event)"
    />
  </div>
</template>

<style scoped>
.board {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 4px;
  container-type: inline-size;
}

@media (min-width: 40rem) {
  .board {
    gap: 8px;
  }
}
</style>
