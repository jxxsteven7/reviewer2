<script setup lang="ts">
import type { CardView, Team } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import KeywordsCard from './KeywordsCard.vue';
import type { Chooser } from './useKeywords';

// The 5 by 5 board. Cards can be chosen only when the viewer may reveal one, or, while a PI
// marks the cards a clue is meant for, only the group's own that are still to be found
// (`targeting`, the group). `choosers` holds, for each card, the others in the group who have
// chosen it. A `large` board, for a big screen, sets its words in bigger type. A `marked` card is
// the one a replay's step is about, and `targets` are the cards a PI meant, in the order marked.
const props = withDefaults(
  defineProps<{
    cards: CardView[];
    selectable: boolean;
    selected: number | null;
    choosers?: Chooser[][];
    lang: string;
    large?: boolean;
    marked?: number | null;
    targeting?: Team | null;
    targets?: number[];
  }>(),
  { choosers: () => [], large: false, marked: null, targeting: null, targets: () => [] },
);
const open = (card: CardView) =>
  props.selectable && !card.revealed && (props.targeting === null || card.color === props.targeting);
const order = (index: number) => (props.targets.includes(index) ? props.targets.indexOf(index) + 1 : null);
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
      :selectable="open(card)"
      :selected="selected === index"
      :choosers="choosers[index] ?? []"
      :large="large"
      :marked="marked === index"
      :target="order(index)"
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
