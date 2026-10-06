<script setup lang="ts">
import type { CardView } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { hyphenate } from './hyphenate';

// One card. A revealed card is filled with its color. A card whose color the viewer may know
// without its being revealed (a PI's key, or the end of the game) is tinted with a colored band.
// Every color also comes with a short text label, so that color is never the only signal.
const props = defineProps<{ card: CardView; index: number; selectable: boolean; selected: boolean }>();
const emit = defineEmits<{ select: [index: number] }>();
const { t } = useI18n();

const HAN = /\p{Script=Han}/u;

// Long words get smaller type so that they fit on a phone.
const size = computed(() => {
  const length = [...props.card.word].length;
  if (HAN.test(props.card.word)) return length <= 3 ? 'm' : length === 4 ? 's' : 'xs';
  return length <= 7 ? 'm' : length <= 10 ? 's' : 'xs';
});

const state = computed(() => {
  if (!props.card.color) return 'hidden';
  return props.card.revealed ? 'revealed' : 'known';
});

const label = computed(() => (props.card.color ? t(`game.card.${props.card.color}`) : ''));
const ariaLabel = computed(() => [props.card.word, props.card.color ? label.value : t('game.hidden')].join(', '));
</script>

<template>
  <button
    type="button"
    class="card"
    :class="[state, card.color, size, { selected, selectable }]"
    :disabled="!selectable"
    :aria-pressed="selectable ? selected : undefined"
    :aria-label="ariaLabel"
    @click="emit('select', index)"
  >
    <span class="word">{{ hyphenate(card.word) }}</span>
    <span v-if="card.color" class="tag" aria-hidden="true">{{ label }}</span>
    <span v-if="card.revealed && card.color === 'reviewer2'" class="stamp" aria-hidden="true">{{
      t('game.stamp')
    }}</span>
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
  overflow: hidden;
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

.selectable {
  cursor: pointer;
}

.selected {
  border: 2px solid var(--ink);
  box-shadow: inset 0 0 0 1px var(--ink);
}

.card:disabled {
  color: var(--ink);
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

.card:disabled.revealed {
  color: var(--paper);
}

.card:disabled.revealed.neutral {
  color: var(--ink);
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
