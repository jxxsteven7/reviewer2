<script setup lang="ts">
import { hasHan, type CardView } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatList } from '../../core/i18n';
import { hyphenate } from './hyphenate';

// One card. A revealed card is filled with its color. A card whose color the viewer may know
// without its being revealed (a PI's key, or the end of the game) is tinted with a colored band.
// Every color also comes with a short text label, so that color is never the only signal. The
// names of the others in the group who have chosen the card run along its bottom. On a big
// screen the cards are `large`, with bigger type.
const props = withDefaults(
  defineProps<{
    card: CardView;
    index: number;
    selectable: boolean;
    selected: boolean;
    choosers: string[];
    large?: boolean;
  }>(),
  { large: false },
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
const chosenBy = computed(() => formatList(locale.value, props.choosers));
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
    :class="[state, card.color, size, { large, selected, selectable, chosen: choosers.length > 0 }]"
    :aria-disabled="selectable ? undefined : 'true'"
    :tabindex="selectable ? undefined : -1"
    :aria-pressed="selectable ? selected : undefined"
    :aria-label="ariaLabel"
    @click="selectable && emit('select', index)"
  >
    <span class="word">{{ hyphenate(card.word) }}</span>
    <span v-if="card.color" class="tag" aria-hidden="true">{{ label }}</span>
    <span v-if="card.revealed && card.color === 'reviewer2'" class="stamp" aria-hidden="true">{{
      t('game.stamp')
    }}</span>
    <span v-if="choosers.length" class="choosers" aria-hidden="true">{{ chosenBy }}</span>
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
  aspect-ratio: 5 / 4;
  padding: 4px;
  /* clip, unlike hidden, lets a card grow past 5:4 when its word needs the room, so that a
     two-line word between a PI's color band and the names of the students is never cut off. */
  overflow: hidden;
  overflow: clip;
  border: 1px solid var(--ink-3);
  border-radius: var(--radius-card);
  background: var(--paper);
  color: var(--ink);
  line-height: 1.15;
  text-align: center;
  cursor: default;
  touch-action: manipulation;
  transition:
    background-color 180ms ease,
    color 180ms ease,
    border-color 180ms ease;
}

.word {
  max-width: 100%;
  overflow-wrap: break-word;
  font-weight: 600;
}

.card:lang(en) .word {
  font-family: var(--font-serif);
}

/* Sizes: a fixed size first, for browsers without container units. */
.m .word {
  font-size: 13px;
  font-size: clamp(12px, 3.6cqi, 22px);
}

.s .word {
  font-size: 11.5px;
  font-size: clamp(11px, 3cqi, 18px);
}

.xs .word {
  font-size: 10px;
  font-size: clamp(10px, 2.5cqi, 15px);
}

/* On a big screen the type grows with the board, further than on a phone or a laptop. */
.large.m .word {
  font-size: 16px;
  font-size: clamp(14px, 3.6cqi, 30px);
}

.large.s .word {
  font-size: 14px;
  font-size: clamp(12px, 3cqi, 26px);
}

.large.xs .word {
  font-size: 12px;
  font-size: clamp(11px, 2.5cqi, 22px);
}

.selectable {
  cursor: pointer;
}

.selected {
  border: 2px solid var(--ink);
  box-shadow: inset 0 0 0 1px var(--ink);
}

@media (hover: hover) {
  .selectable:not(.selected):hover {
    border-color: var(--ink);
  }
}

.tag {
  position: absolute;
  top: 3px;
  left: 4px;
  font-size: 9px;
  font-weight: 600;
  font-variant-caps: all-small-caps;
  letter-spacing: 0.04em;
  line-height: 1;
  opacity: 0.85;
}

/* Room for the label in the corner. */
.known,
.revealed {
  padding-top: 12px;
}

/* A color the viewer knows but that hasn't been revealed: a tint and a band along the top. */
.known {
  border-top-width: 4px;
}

.known.red {
  border-color: var(--red);
  background: var(--red-tint);
}

.known.blue {
  border-color: var(--blue);
  background: var(--blue-tint);
}

.known.neutral {
  border-color: var(--neutral);
  background: var(--neutral-tint);
}

.known.reviewer2 {
  border-color: var(--r2);
  border-width: 3px 3px 3px;
  background: var(--paper);
}

/* Revealed: the full color. */
.revealed.red {
  border-color: var(--red);
  background: var(--red);
  color: var(--paper);
}

.revealed.blue {
  border-color: var(--blue);
  background: var(--blue);
  color: var(--paper);
}

.revealed.neutral {
  border-color: var(--neutral);
  background: var(--neutral);
  color: var(--ink);
}

.revealed.reviewer2 {
  border-color: var(--r2);
  background: var(--r2);
  color: var(--paper);
}

.revealed .word {
  opacity: 0.9;
}

/* Room for the names of the students who chose the card. */
.chosen {
  padding-bottom: 13px;
}

.choosers {
  position: absolute;
  right: 3px;
  bottom: 2px;
  left: 3px;
  overflow: hidden;
  font-size: 9px;
  font-weight: 600;
  line-height: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hidden .choosers,
.known .choosers {
  border-top: 1px dotted currentColor;
}

.stamp {
  margin-top: 2px;
  padding: 0 4px;
  border: 2px solid var(--stamp);
  border-radius: 3px;
  color: var(--stamp);
  font-size: 11px;
  font-size: clamp(11px, 2.8cqi, 18px);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  transform: rotate(-6deg);
}
</style>
