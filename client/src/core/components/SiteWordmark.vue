<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';

const { t } = useI18n();
</script>

<template>
  <RouterLink to="/" class="wordmark">{{ t('app.name') }}</RouterLink>
</template>

<style scoped>
.wordmark {
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: var(--text-lg);
  font-weight: 600;
  font-variant-caps: all-small-caps;
  letter-spacing: 0.08em;
  text-decoration: none;
  white-space: nowrap;
}
</style>
