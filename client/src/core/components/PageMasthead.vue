<script setup lang="ts">
import SiteWordmark from './SiteWordmark.vue';
</script>

<template>
  <header class="masthead">
    <SiteWordmark />
    <div class="end"><slot /></div>
  </header>
</template>

<style scoped>
.masthead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: 56px;
  padding-top: env(safe-area-inset-top);
  border-bottom: 1px solid var(--ink);
}

.end {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}
</style>
