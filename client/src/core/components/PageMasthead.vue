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
  min-height: 64px;
  padding-top: env(safe-area-inset-top);
}

.end {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  min-width: 0;
}
</style>
