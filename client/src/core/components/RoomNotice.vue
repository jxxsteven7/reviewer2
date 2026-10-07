<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';

// A message in place of a room: it doesn't exist, it has closed, or something failed.
defineProps<{ title?: string; body: string }>();
const { t } = useI18n();
</script>

<template>
  <section class="notice">
    <h1 v-if="title">{{ title }}</h1>
    <p>{{ body }}</p>
    <RouterLink to="/">{{ t('room.home') }}</RouterLink>
  </section>
</template>

<style scoped>
.notice {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-7) 0;
}

h1 {
  font-size: var(--text-2xl);
}

p {
  color: var(--ink-2);
}
</style>
