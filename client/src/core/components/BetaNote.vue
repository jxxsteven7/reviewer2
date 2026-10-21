<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import BetaPill from './BetaPill.vue';

// A line on a game in beta where its rooms are set up and its records are shown: the "Beta" pill,
// which opens what the beta means (BetaPill.vue), and a line, as `text` names it in the locale
// files, on a beige row.
defineProps<{ game: string; text: string }>();
const { t } = useI18n();
</script>

<template>
  <p class="beta-note">
    <BetaPill :game="game" />
    <span>{{ t(text) }}</span>
  </p>
</template>

<style scoped>
.beta-note {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-card);
  background: var(--paper-2);
  font-size: var(--text-sm);
  line-height: 1.5;
}

.beta-note :deep(.beta) {
  flex: none;
  margin-inline-start: 0;
}
</style>
