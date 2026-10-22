<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { Tint } from '../tints';
import UiButton from './UiButton.vue';

// The way through a replay, in every game (docs/rules/display.md#a-games-room): "Step n of m", the
// buttons to the step before and the next, and between them the slider to any step, which binds
// with v-model to the step shown, from 0; under them, what the step says, its `lines`, the first in
// bold, on a block in the tint of the side it is about, if the game has sides, and beige otherwise.
const at = defineModel<number>({ required: true });
defineProps<{ steps: number; lines: string[]; tint?: Tint | null }>();
const { t } = useI18n();
</script>

<template>
  <p class="position num">{{ t('replay.step', { step: at + 1, steps }) }}</p>
  <div class="controls">
    <UiButton size="small" :disabled="at === 0" @click="at -= 1">{{ t('replay.previous') }}</UiButton>
    <input v-model.number="at" type="range" min="0" :max="steps - 1" step="1" :aria-label="t('replay.slider')" />
    <UiButton size="small" :disabled="at >= steps - 1" @click="at += 1">{{ t('replay.next') }}</UiButton>
  </div>
  <div class="step" :class="tint" aria-live="polite">
    <p v-for="line in lines" :key="line">{{ line }}</p>
  </div>
</template>

<style scoped>
.position {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.controls {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

input[type='range'] {
  flex: 1;
  min-width: 0;
  accent-color: var(--ink);
}

/* The step's lines on a block in the side's tint, as a clue is in the first game's log. */
.step {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-height: 4.5em;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-card);
  background: var(--paper-2);
  font-size: var(--text-sm);
}

.step p:first-child {
  font-weight: var(--weight-black);
}

.step.red {
  background: var(--red-tint);
}

.step.blue {
  background: var(--blue-tint);
}
</style>
