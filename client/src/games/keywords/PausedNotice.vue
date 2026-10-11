<script setup lang="ts">
import { useI18n } from 'vue-i18n';

// What stands in place of the board while the chair has paused the game: the word, a line that
// says the board is hidden, and whatever the page puts in the slot, such as the chair's way to
// resume. A `large` notice is for a big screen.
withDefaults(defineProps<{ large?: boolean }>(), { large: false });
const { t } = useI18n();
</script>

<template>
  <div class="paused" :class="{ large }">
    <p class="paused-title">{{ t('game.paused') }}</p>
    <p class="paused-note">{{ t('game.pausedNote') }}</p>
    <slot />
  </div>
</template>

<style scoped>
.paused {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  min-height: 14rem;
  margin-top: var(--space-3);
  padding: var(--space-5) var(--space-4);
  border: var(--line-strong) dashed var(--ink);
  border-radius: var(--radius-panel);
  text-align: center;
}

.paused.large {
  min-height: 16rem;
  margin-top: var(--space-4);
  padding: var(--space-5);
}

.paused-title {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--weight-display);
  font-synthesis: none;
}

.paused-note,
:slotted(.paused-note) {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.large .paused-note {
  color: inherit;
  font-size: inherit;
}
</style>
