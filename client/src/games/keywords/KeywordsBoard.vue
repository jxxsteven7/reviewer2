<script setup lang="ts">
import { MARKS, otherTeam, type CardView, type Mark, type Team } from '@reviewer2/shared';
import { computed, ref, useId } from 'vue';
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
// chooses a card, two, three and a long press mark it, which the board says with `mark`, and so do
// the keys 1, 2 and 3 on a card that has the focus, which each such card tells assistive
// technology of. For whoever can neither tap a card several times nor press a key, as with a
// screen reader on a phone, three buttons that only screen readers find follow the cards, and mark
// the card that had the focus last. `float` is what the card that has just been revealed did to
// the viewer's points, which rises from it (ScoreFloat.vue).
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
// Which cards take a mark, and how screen readers are told of the keys for it.
const markable = (card: CardView) => props.gestures && !card.revealed;
const keysId = useId();
// The card that had the focus last, for the buttons that mark it, while it is still face down.
const focused = ref<number | null>(null);
const named = computed(() => {
  const card = focused.value === null ? undefined : props.cards[focused.value];
  return card && markable(card) ? { index: focused.value as number, word: card.word } : null;
});
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
      :aria-keyshortcuts="markable(card) ? '1 2 3' : undefined"
      :aria-describedby="markable(card) ? keysId : undefined"
      @select="select"
      @focus="focused = index"
      @pointerdown="press(index, $event)"
      @pointermove="gestures.move"
      @pointerup="gestures.letGo"
      @pointercancel="gestures.letGo"
      @pointerleave="gestures.letGo"
      @keydown="key(index, $event)"
      @contextmenu="menu"
    />
    <template v-if="gestures">
      <p :id="keysId" class="sr-only">{{ t('game.gestures.keys') }}</p>
      <div v-if="named" class="sr-only mark-buttons">
        <button v-for="mark in MARKS" :key="mark" type="button" @click="named && emit('mark', named.index, mark)">
          {{ t(`game.gestures.markAs.${mark}`, { word: named.word }) }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* The gap leaves room for the shadows and for what hangs on the cards' corners (KeywordsCard), and
   the padding for what hangs over the board's edges. */
.board {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 9px 8px;
  padding: 7px 4px 4px 0;
  container-type: inline-size;
}

@media (min-width: 40rem) {
  .board {
    gap: 12px;
    padding-top: 8px;
    padding-bottom: 6px;
  }
}
</style>
