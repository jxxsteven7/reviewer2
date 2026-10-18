<script setup lang="ts">
import LanguageSwitch from '../components/LanguageSwitch.vue';
import PageMasthead from '../components/PageMasthead.vue';
import PageTitle from '../components/PageTitle.vue';
import { pageTitle, usePageHead } from '../head';

// The frame of the pages that links in mails lead to, and of the one that sends those mails: the
// title on its bar, with the way back when there is a page before (PageTitle.vue), and the page in a
// card under it. The tab's title is the page's too.
const props = defineProps<{ title: string }>();
usePageHead(() => ({ title: pageTitle(props.title) }));
</script>

<template>
  <div class="page mail-page">
    <PageMasthead back><LanguageSwitch /></PageMasthead>
    <main>
      <PageTitle>{{ title }}</PageTitle>
      <section class="content">
        <slot />
      </section>
    </main>
  </div>
</template>

<style scoped>
main {
  padding-bottom: var(--space-7);
}

.content {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 26rem;
  padding: var(--space-5) var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
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
