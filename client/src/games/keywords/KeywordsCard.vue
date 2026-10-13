<script setup lang="ts">
import { hasHan, type CardView } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import PlayerAvatar from '../../core/components/PlayerAvatar.vue';
import { formatList } from '../../core/i18n';
import { hyphenate } from './hyphenate';
import type { Chooser } from './useKeywords';

// One card, a sticker on the table. A revealed card is filled with its color and pressed into
// the table. A card whose color the viewer may know without its being revealed (a PI's key, or
// the end of the game) is tinted. Every color also comes with a short label in the corner, so that
// color is never the only signal; the accessible name says the color in full. The others in the
// group who have chosen the card hang their avatars on its corner; the card's accessible name says
// who they are. On a big screen the cards are `large`, with bigger type. A `marked` card, in a
// replay, is outlined.
const props = withDefaults(
  defineProps<{
    card: CardView;
    index: number;
    selectable: boolean;
    selected: boolean;
    choosers: Chooser[];
    large?: boolean;
    marked?: boolean;
  }>(),
  { large: false, marked: false },
);
const emit = defineEmits<{ select: [index: number] }>();
const { t, locale } = useI18n();

// Long words get smaller type so that they fit on a phone.
const size = computed(() => {
  const length = [...props.card.word].length;
  if (hasHan(props.card.word)) return length <= 3 ? 'm' : length === 4 ? 's' : 'xs';
  return length <= 7 ? 'm' : length <= 10 ? 's' : 'xs';
});

const state = computed(() => {
  if (!props.card.color) return 'hidden';
  return props.card.revealed ? 'revealed' : 'known';
});

const label = computed(() => (props.card.color ? t(`game.card.${props.card.color}`) : ''));
const tag = computed(() => (props.card.color ? t(`game.cardTag.${props.card.color}`) : ''));
const chosenBy = computed(() =>
  formatList(
    locale.value,
    props.choosers.map((chooser) => chooser.name),
  ),
);
const ariaLabel = computed(() =>
  [
    props.card.word,
    props.card.color ? label.value : t('game.hidden'),
    ...(props.choosers.length ? [t('game.chosenBy', { names: chosenBy.value })] : []),
  ].join(', '),
);
</script>

<template>
  <!--
    A card that can't be chosen stays a button that assistive technology reads like the others,
    word and color included, but it says so with aria-disabled and leaves the Tab order: a
    disabled button is skipped by screen readers' quick navigation too, and a PI reading the key
    needs every card.
  -->
  <button
    type="button"
    class="card"
    :class="[state, card.color, size, { large, selected, selectable, marked, chosen: choosers.length > 0 }]"
    :aria-disabled="selectable ? undefined : 'true'"
    :tabindex="selectable ? undefined : -1"
    :aria-pressed="selectable ? selected : undefined"
    :aria-label="ariaLabel"
    @click="selectable && emit('select', index)"
  >
    <span class="word">{{ hyphenate(card.word) }}</span>
    <span v-if="card.color" class="tag" aria-hidden="true">{{ tag }}</span>
    <span v-if="card.revealed && card.color === 'reviewer2'" class="stamp" aria-hidden="true">{{
      t('game.stamp')
    }}</span>
    <span v-if="choosers.length" class="choosers" aria-hidden="true">
      <PlayerAvatar v-for="chooser in choosers" :key="chooser.name" :name="chooser.name" :avatar="chooser.avatar" />
    </span>
  </button>
</template>

<style scoped>
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 48px;
  aspect-ratio: 7 / 6;
  padding: 4px 3px;
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-card);
  background: var(--paper);
  box-shadow: var(--shadow-1);
  color: var(--ink);
  line-height: 1.15;
  text-align: center;
  cursor: default;
  touch-action: manipulation;
  transition:
    transform var(--motion),
    box-shadow var(--motion),
    background-color var(--motion),
    color var(--motion);
}

.word {
  max-width: 100%;
  overflow-wrap: break-word;
  font-weight: var(--weight-black);
}

/* Sizes: a fixed size first, for browsers without container units. */
.m .word {
  font-size: 14px;
  font-size: clamp(13px, 4.4cqi, 26px);
}

.s .word {
  font-size: 12px;
  font-size: clamp(11px, 3.6cqi, 22px);
}

.xs .word {
  font-size: 10px;
  font-size: clamp(10px, 3cqi, 18px);
}

/* English words run longer than Chinese ones of the same count, so they are set a little
   smaller, and break less often. */
.card:lang(en).m .word {
  font-size: 13px;
  font-size: clamp(12px, 3.7cqi, 24px);
}

.card:lang(en).s .word {
  font-size: 11.5px;
  font-size: clamp(11px, 3.1cqi, 20px);
}

.card:lang(en).xs .word {
  font-size: 10px;
  font-size: clamp(10px, 2.6cqi, 17px);
}

/* On a big screen the type grows with the board, further than on a phone or a laptop. */
.large.m .word,
.card:lang(en).large.m .word {
  font-size: 16px;
  font-size: clamp(14px, 4.4cqi, 34px);
}

.large.s .word,
.card:lang(en).large.s .word {
  font-size: 14px;
  font-size: clamp(12px, 3.6cqi, 28px);
}

.large.xs .word,
.card:lang(en).large.xs .word {
  font-size: 12px;
  font-size: clamp(11px, 3cqi, 24px);
}

.selectable {
  cursor: pointer;
}

.selectable:active {
  transform: translate(var(--shift-1), var(--shift-1));
  box-shadow: none;
}

/* The viewer's own choice: the card takes the table's yellow. */
.selected {
  background: var(--bg);
}

@media (hover: hover) {
  .selectable:not(.selected):hover {
    background: var(--paper-2);
  }
}

/* The label is small, so it is set in the full color of the type: dimmed, it would fall under
   4.5:1 on a revealed red or blue card. */
.tag {
  position: absolute;
  top: 3px;
  left: 5px;
  font-size: 10px;
  font-weight: var(--weight-black);
  letter-spacing: 0.04em;
  line-height: 1;
  text-transform: uppercase;
}

/* The English labels, in capitals, are set a little smaller and tighter, to the size of the
   Chinese ones. */
.card:lang(en) .tag {
  font-size: 9px;
  letter-spacing: 0.02em;
}

/* Room for the label in the corner. */
.known,
.revealed {
  padding-top: 13px;
}

/* A color the viewer knows but that hasn't been revealed: a tint. */
.known.red {
  background: var(--red-tint);
}

.known.blue {
  background: var(--blue-tint);
}

.known.neutral {
  background: var(--neutral-tint);
}

.known.reviewer2 {
  background: var(--r2);
  color: var(--on-r2);
}

/* Revealed: the full color, pressed into the table. */
.revealed {
  transform: translate(var(--shift-1), var(--shift-1));
  box-shadow: none;
}

.revealed.red {
  background: var(--red);
  color: var(--on-red);
}

.revealed.blue {
  background: var(--blue);
  color: var(--on-blue);
}

.revealed.neutral {
  background: var(--neutral);
  color: var(--on-neutral);
}

.revealed.neutral .word {
  text-decoration: line-through;
  text-decoration-thickness: 2px;
}

.revealed.reviewer2 {
  background: var(--r2);
  color: var(--on-r2);
}

/* The avatars of the students who chose the card hang on its top right corner. */
.choosers {
  position: absolute;
  top: -9px;
  right: -7px;
  display: flex;
  flex-direction: row-reverse;
}

.choosers :deep(.avatar) {
  width: 24px;
  height: 24px;
  font-size: 0.75rem;
  box-shadow: var(--shadow-1);
}

.choosers :deep(.avatar + .avatar) {
  margin-right: -8px;
}

.large .choosers :deep(.avatar) {
  width: 30px;
  height: 30px;
  font-size: 0.9rem;
}

/* The card that a replay's step is about. */
.marked {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

.stamp {
  margin-top: 2px;
  padding: 0 5px;
  border: var(--line-thin) solid var(--stamp);
  border-radius: var(--radius-small);
  color: var(--stamp);
  font-size: 11px;
  font-size: clamp(11px, 2.8cqi, 18px);
  font-weight: var(--weight-black);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  transform: rotate(-6deg);
}
</style>
