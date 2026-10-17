<script setup lang="ts">
import { AUTHOR_ACCOUNT } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import TitleInfo from './TitleInfo.vue';

// An account's number, from 1 up in the order of registration, as its own page and its public
// page show it (docs/architecture.md#public-profiles). The first account is the author's, which
// gets a badge to say so, which a tap explains.
defineProps<{ id: number }>();
const { t } = useI18n();
</script>

<template>
  <span class="number">
    <span class="num">{{ t('playerPage.number', { id }) }}</span>
    <TitleInfo v-if="id === AUTHOR_ACCOUNT" :title="{ kind: 'author' }" class="author press press-small">{{
      t('playerPage.author')
    }}</TitleInfo>
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

/* The badge is a button that a tap opens (TitleInfo.vue). Its box reaches above and below it, out
   of sight, to 44px tall, centered on it, as far as the lines around it, 8px away, allow; the
   public profile, whose lines are closer, lets it reach down alone (ProfileCard.vue). */
.author {
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: 1px var(--space-3);
  border: var(--line-thin) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--bg);
  box-shadow: var(--shadow-0);
  color: var(--ink);
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: var(--weight-display);
  font-synthesis: none;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.author::before {
  content: '';
  position: absolute;
  inset: calc(50% - 22px) 0;
}
</style>
