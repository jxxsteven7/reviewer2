<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import LanguageSwitch from '../components/LanguageSwitch.vue';
import PageMasthead from '../components/PageMasthead.vue';

// The frame of the pages that links in mails lead to, and of the one that sends those mails.
defineProps<{ title: string }>();
const { t } = useI18n();
</script>

<template>
  <div class="page mail-page">
    <PageMasthead><LanguageSwitch /></PageMasthead>
    <main>
      <RouterLink to="/" class="back">{{ t('account.back') }}</RouterLink>
      <section class="content">
        <h1>{{ title }}</h1>
        <slot />
      </section>
    </main>
  </div>
</template>

<style scoped>
main {
  padding: var(--space-4) 0 var(--space-7);
}

.back {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.content {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 24rem;
  padding-top: var(--space-3);
}

h1 {
  font-size: var(--text-2xl);
}

.content :deep(.intro) {
  color: var(--ink-2);
}

.content :deep(.problem) {
  color: var(--red);
  font-size: var(--text-sm);
}

.content :deep(.form) {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
</style>
