<script setup lang="ts">
// A room's settings, for everyone to read, in every game: a row each, what the setting is in grey
// on the left and how the room has it in bold on the right.
defineProps<{ rows: { key: string; label: string; value: string }[] }>();
</script>

<template>
  <dl class="settings-summary">
    <template v-for="row in rows" :key="row.key">
      <dt>{{ row.label }}</dt>
      <dd :class="row.key">{{ row.value }}</dd>
    </template>
  </dl>
</template>

<style scoped>
.settings-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-2) var(--space-4);
  margin: 0;
  font-size: var(--text-sm);
}

dt {
  color: var(--ink-2);
  font-weight: var(--weight-bold);
}

dd {
  margin: 0;
  font-weight: var(--weight-black);
  text-align: right;
}
</style>
