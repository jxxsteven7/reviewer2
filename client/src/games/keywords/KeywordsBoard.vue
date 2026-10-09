<script setup lang="ts">
import type { CardView } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import KeywordsCard from './KeywordsCard.vue';
import type { Chooser } from './useKeywords';

// The 5 by 5 board. Cards can be chosen only when the viewer may reveal one. `choosers` holds,
// for each card, the others in the group who have chosen it. A `large` board, for a big screen,
// sets its words in bigger type.
withDefaults(
  defineProps<{
    cards: CardView[];
    selectable: boolean;
    selected: number | null;
    choosers?: Chooser[][];
    lang: string;
    large?: boolean;
  }>(),
  { choosers: () => [], large: false },
);
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
      :choosers="choosers[index] ?? []"
      :large="large"
      @select="emit('select', $event)"
    />
  </div>
</template>

<style scoped>
/* The gap leaves room for the shadows and for the avatars on the cards' corners. */
.board {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 9px 8px;
  padding: 6px 4px 4px 0;
  container-type: inline-size;
}

@media (min-width: 40rem) {
  .board {
    gap: 12px;
    padding-top: 8px;
  }
}
</style>
