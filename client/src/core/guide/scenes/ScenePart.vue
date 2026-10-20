<script setup lang="ts">
// A part of a page in a scene of the site's chapters, drawn as the account page draws its parts: a
// card with its title.
defineProps<{ title?: string }>();
</script>

<template>
  <section class="part">
    <h2 v-if="title">{{ title }}</h2>
    <slot />
  </section>
</template>

<style scoped>
.part {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
}

.part h2 {
  font-size: var(--text-xl);
}
</style>
