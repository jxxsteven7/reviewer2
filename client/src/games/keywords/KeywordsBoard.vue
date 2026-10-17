<script setup lang="ts">
import { MARKS, otherTeam, type CardView, type Mark, type Team } from '@reviewer2/shared';
import { computed, nextTick, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Shown } from '../../core/components/ScoreFloat.vue';
import KeywordsCard from './KeywordsCard.vue';
import MarkMenu from './MarkMenu.vue';
import { useCardGestures } from './useCardGestures';
import type { Chooser } from './useKeywords';
import type { Turned } from './useTurnedCard';

// The 5 by 5 board. Cards can be chosen only when the viewer may reveal one, or, while a PI
// marks the cards a clue is meant for, only the group's own that are still to be found
// (`targeting`, the group). `choosers` holds, for each card, the others in the group who have
// chosen it. A `large` board, for a big screen, sets its words in bigger type. A `marked` card is
// the one a replay's step is about, and `targets` are the cards a PI meant, in the order marked.
// `notes` are the marks of the viewer's group, by card, for its students and its PI, and `team` that
// group; the PI only reads them (`quietNotes`). A student's board takes `gestures`
// (useCardGestures.ts): a tap chooses a card at once, and a long press, or a right click, opens the
// menu of marks for it (MarkMenu.vue), whose choice the board says with `mark`, as do the keys 1, 2
// and 3 on a card that has the focus, which each such card tells assistive technology of. For a
// screen reader on a phone, which can press no key, three buttons that only screen readers find
// follow the cards, and mark the card that had the focus last. `turned` is the card that has just
// been turned face up in front of the viewer, which turns over (useTurnedCard.ts), and `float` what
// the card that has just been revealed did to the viewer's points, which rises from it
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
    turned?: Turned | null;
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
    turned: null,
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
// A revealed card takes no mark, and opens no menu of marks.
const markable = (card: CardView) => props.gestures && !card.revealed;
const takesMark = (card: number) => {
  const target = props.cards[card];
  return target !== undefined && markable(target) && !!props.team;
};
const board = ref<HTMLElement | null>(null);
// The card whose menu of marks is open, with the element that the menu lifts a copy of, and the
// menu itself.
const holding = ref<{ index: number; source: HTMLElement } | null>(null);
const menu = ref<InstanceType<typeof MarkMenu> | null>(null);
const markCard = (card: number, chosen: Mark) => {
  if (takesMark(card)) emit('mark', card, chosen);
};
const cardGestures = useCardGestures({
  tap: (card) => emit('select', card),
  // A press is held only on a card that takes a mark: another sinks nothing.
  holds: takesMark,
  hold: (card) => {
    const source = [...(board.value?.children ?? [])].filter((child) => child.classList.contains('card'))[card];
    if (takesMark(card) && source instanceof HTMLElement) holding.value = { index: card, source };
  },
  mark: markCard,
});
// The menu closes by itself, at once, once its card can take no mark: it was revealed meanwhile,
// or the viewer may no longer mark, as when the game has ended. The card has the focus again if
// the menu had it, once the board shows it again.
watch(
  () => holding.value !== null && !takesMark(holding.value.index),
  (over) => {
    if (!over || holding.value === null) return;
    const { source } = holding.value;
    const hadFocus = menu.value?.hasFocus() ?? false;
    holding.value = null;
    if (hadFocus) void nextTick(() => source.focus({ preventScroll: true }));
  },
);
const pressing = cardGestures.pressing;
function select(card: number) {
  if (props.gestures) cardGestures.click(card);
  else emit('select', card);
}
const press = (card: number, event: PointerEvent) => props.gestures && cardGestures.press(card, event);
const key = (card: number, event: KeyboardEvent) => props.gestures && cardGestures.key(card, event);
// A long press on a phone opens no menu of the browser's, and a right click opens ours.
const contextMenu = (card: number, event: Event) => props.gestures && cardGestures.contextMenu(card, event);
// How screen readers are told of the keys for a mark.
const keysId = useId();
// The card that had the focus last, for the buttons that mark it, while it is still face down.
const focused = ref<number | null>(null);
const named = computed(() => {
  const card = focused.value === null ? undefined : props.cards[focused.value];
  return card && markable(card) ? { index: focused.value as number, word: card.word } : null;
});
</script>

<template>
  <div ref="board" class="board" role="group" :aria-label="t('game.board')" :lang="lang">
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
      :turning="turned?.card === index ? turned : null"
      :float="float?.card === index ? float : null"
      :class="{ pressing: pressing === index, lifting: holding?.index === index }"
      :aria-keyshortcuts="markable(card) ? '1 2 3' : undefined"
      :aria-describedby="markable(card) ? keysId : undefined"
      @select="select"
      @focus="focused = index"
      @pointerdown="press(index, $event)"
      @pointermove="cardGestures.move"
      @pointerup="cardGestures.letGo"
      @pointercancel="cardGestures.letGo"
      @pointerleave="cardGestures.letGo"
      @keydown="key(index, $event)"
      @contextmenu="contextMenu(index, $event)"
    />
    <MarkMenu
      v-if="gestures && holding && team"
      ref="menu"
      :source="holding.source"
      :word="cards[holding.index]?.word ?? ''"
      :current="notes.get(holding.index) ?? null"
      :team="team"
      @choose="markCard(holding.index, $event)"
      @close="holding = null"
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
