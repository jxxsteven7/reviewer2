<script setup lang="ts">
import { MARKS, otherTeam, type Mark, type Team } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import MarkSticker from './MarkSticker.vue';

// What a student's tap on a card does (docs/games/keywords.md#talking-it-over): choose it, in the
// group's own guess phase, or mark it for the group as one of its own, one of the other group's or
// maybe Reviewer 2, at any time. Four buttons in a row, the one in use filled with ink; each mark's
// button carries the sticker that the mark puts on a card. While the group may not choose, its
// button is greyed out. Under the buttons, while a mark is in use, what a tap does with it.
export type Tool = 'choose' | Mark;

const props = defineProps<{ team: Team; canChoose: boolean }>();
const tool = defineModel<Tool>({ required: true });
const { t } = useI18n();

// The sticker's color: the group's own, the other group's, or ink for Reviewer 2.
const colorOf = (mark: Mark) => (mark === 'ours' ? props.team : mark === 'theirs' ? otherTeam(props.team) : 'r2');
</script>

<template>
  <div class="mark-tools">
    <div class="tool-row" role="group" :aria-label="t('game.tools.label')">
      <button
        type="button"
        class="tool"
        :class="{ on: tool === 'choose' }"
        :aria-pressed="tool === 'choose'"
        :disabled="!canChoose"
        @click="tool = 'choose'"
      >
        {{ t('game.tools.choose') }}
      </button>
      <button
        v-for="mark in MARKS"
        :key="mark"
        type="button"
        class="tool"
        :class="{ on: tool === mark }"
        :aria-pressed="tool === mark"
        @click="tool = mark"
      >
        <MarkSticker :mark="mark" :color="colorOf(mark)" small />
        {{ t(`game.tools.${mark}`) }}
      </button>
    </div>
    <p v-if="tool !== 'choose'" class="hint">{{ t('game.tools.hint') }}</p>
  </div>
</template>

<style scoped>
.mark-tools {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* One pill of four even parts, 44 px high to the finger with its outline (docs/design.md). */
.tool-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 2px;
  padding: 2px;
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--paper);
}

.tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 0;
  min-height: 40px;
  padding: 0 var(--space-1);
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  white-space: nowrap;
  cursor: pointer;
  touch-action: manipulation;
}

/* Ink is flat: the tool in use has no shadow. */
.tool.on {
  background: var(--ink);
  color: var(--on-ink);
}

.tool.on :deep(.mark-sticker) {
  border-color: var(--on-ink);
}

.tool:disabled {
  color: var(--ink-2);
  opacity: 0.45;
  cursor: not-allowed;
}

.tool:focus-visible {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}
</style>
