<script setup lang="ts" generic="Entry">
// A section of a list of thanks in its folded card (FoldedList.vue): its heading, in the page's
// language, and its entries, one to a line, which the component that uses this one shows.
defineProps<{ heading: string; entries: readonly Entry[] }>();
defineSlots<{ default(props: { entry: Entry }): unknown }>();
</script>

<template>
  <section class="group">
    <h3>{{ heading }}</h3>
    <ul>
      <li v-for="(entry, index) in entries" :key="index">
        <slot :entry="entry" />
      </li>
    </ul>
  </section>
</template>

<style scoped>
.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

h3 {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
}

ul {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

li {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-card);
  background: var(--paper-2);
  overflow-wrap: anywhere;
}
</style>
