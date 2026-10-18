<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { pageTitle, usePageHead } from '../head';

const { t } = useI18n();
usePageHead(() => ({ title: pageTitle(t('notFound.title')) }));
</script>

<template>
  <main class="not-found page">
    <h1>{{ t('notFound.title') }}</h1>
    <p>{{ t('notFound.body') }}</p>
    <RouterLink to="/">{{ t('notFound.home') }}</RouterLink>
  </main>
</template>

<style scoped>
.not-found {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  max-width: var(--page-narrow);
  margin: var(--space-7) auto;
  padding: var(--space-5);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
}

h1 {
  font-size: var(--text-2xl);
}
</style>
