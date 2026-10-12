<script setup lang="ts">
import { AUTHOR_ACCOUNT } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';

// An account's number, from 1 up in the order of registration, as its own page and its public
// page show it (docs/architecture.md#public-profiles). The first account is the author's, which
// gets a badge to say so.
defineProps<{ id: number }>();
const { t } = useI18n();
</script>

<template>
  <span class="number">
    <span class="num">{{ t('playerPage.number', { id }) }}</span>
    <span v-if="id === AUTHOR_ACCOUNT" class="author">{{ t('playerPage.author') }}</span>
  </span>
</template>

<style scoped>
.number {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.author {
  display: inline-flex;
  align-items: center;
  padding: 1px var(--space-3);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--ink);
  box-shadow: var(--shadow-1);
  color: var(--on-ink);
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: var(--weight-display);
  font-synthesis: none;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
</style>
