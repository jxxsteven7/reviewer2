<script setup lang="ts">
import BackButton from '../components/BackButton.vue';
import LanguageSwitch from '../components/LanguageSwitch.vue';
import PageMasthead from '../components/PageMasthead.vue';

// The frame of the pages that links in mails lead to, and of the one that sends those mails.
defineProps<{ title: string }>();
</script>

<template>
  <div class="page mail-page">
    <PageMasthead><LanguageSwitch /></PageMasthead>
    <main>
      <BackButton />
      <section class="content">
        <h1>{{ title }}</h1>
        <slot />
      </section>
    </main>
  </div>
</template>

<style scoped>
main {
  padding: var(--space-3) 0 var(--space-7);
}

.content {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 26rem;
  margin-top: var(--space-3);
  padding: var(--space-5) var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
}

h1 {
  font-size: var(--text-2xl);
}

.content :deep(.problem) {
  color: var(--red-deep);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.content :deep(.form) {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
</style>
