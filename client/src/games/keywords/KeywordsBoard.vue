<script setup lang="ts">
import { otherTeam, type CardView, type Mark, type Team } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import type { Shown } from '../../core/components/ScoreFloat.vue';
import KeywordsCard from './KeywordsCard.vue';
import { useCardGestures } from './useCardGestures';
import type { Chooser } from './useKeywords';

// The 5 by 5 board. Cards can be chosen only when the viewer may reveal one, or, while a PI
// marks the cards a clue is meant for, only the group's own that are still to be found
// (`targeting`, the group). `choosers` holds, for each card, the others in the group who have
// chosen it. A `large` board, for a big screen, sets its words in bigger type. A `marked` card is
// the one a replay's step is about, and `targets` are the cards a PI meant, in the order marked.
// `notes` are the marks of the viewer's group, by card, for its students and its PI, and `team` that
// group; the PI only reads them (`quietNotes`), small inside a card's corner, clear of the numbers
// of the cards a clue is meant for. A student's board takes `gestures` (useCardGestures.ts): one tap
// chooses a card, two, three and a long press mark it, which the board says with `mark`. `float`
// is what the card that has just been revealed did to the viewer's points, which rises from it
// (ScoreFloat.vue).
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
    notes?: ReadonlyMap<number, Mark>;
    team?: Team | null;
    quietNotes?: boolean;
    gestures?: boolean;
    float?: (Shown & { card: number }) | null;
  }>(),
  {
    choosers: () => [],
    large: false,
    marked: null,
    targeting: null,
    targets: () => [],
    notes: () => new Map(),
    team: null,
    quietNotes: false,
    gestures: false,
    float: null,
  },
);
const open = (card: CardView) =>
  props.selectable && !card.revealed && (props.targeting === null || card.color === props.targeting);
const order = (index: number) => (props.targets.includes(index) ? props.targets.indexOf(index) + 1 : null);
// A mark as its card shows it: in the group's own color, the other group's, or Reviewer 2's.
function noteOf(index: number) {
  const mark = props.notes.get(index);
  if (!mark || !props.team) return null;
  return { mark, color: mark === 'ours' ? props.team : mark === 'theirs' ? otherTeam(props.team) : ('r2' as const) };
}
const emit = defineEmits<{ select: [index: number]; mark: [index: number, mark: Mark] }>();
const { t } = useI18n();
// A revealed card takes no mark.
const gestures = useCardGestures({
  tap: (card) => emit('select', card),
  mark: (card, mark) => props.cards[card] && !props.cards[card].revealed && emit('mark', card, mark),
});
function select(card: number) {
  if (props.gestures) gestures.click(card);
  else emit('select', card);
}
const press = (card: number, event: PointerEvent) => props.gestures && gestures.press(card, event);
const key = (card: number, event: KeyboardEvent) => props.gestures && gestures.key(card, event);
// A long press on a phone opens no menu.
const menu = (event: Event) => props.gestures && event.preventDefault();
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
      :note="card.revealed ? null : noteOf(index)"
      :note-quiet="quietNotes"
      :float="float?.card === index ? float : null"
      @select="select"
      @pointerdown="press(index, $event)"
      @pointermove="gestures.move"
      @pointerup="gestures.letGo"
      @pointercancel="gestures.letGo"
      @pointerleave="gestures.letGo"
      @keydown="key(index, $event)"
      @contextmenu="menu"
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
