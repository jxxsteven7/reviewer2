<script setup lang="ts">
import SiteWordmark from './SiteWordmark.vue';

// The header of a page: the wordmark, and what the page puts at the other end. A room's
// masthead is `compact`: on a narrow screen its wordmark is the tile alone.
withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });
</script>

<template>
  <header class="masthead">
    <SiteWordmark :compact="compact" />
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
