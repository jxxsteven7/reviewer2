<script setup lang="ts">
import type { CardView } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import KeywordsCard from './KeywordsCard.vue';

// The 5 by 5 board. Cards can be chosen only when the viewer may reveal one. `choosers` holds,
// for each card, the names of the others in the group who have chosen it.
withDefaults(
  defineProps<{
    cards: CardView[];
    selectable: boolean;
    selected: number | null;
    choosers?: string[][];
    lang: string;
  }>(),
  { choosers: () => [] },
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
