<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';

// The site's name, with its "R2" tile. The tile is drawn by CSS inside a span that assistive
// technology skips, so that the link reads as "Reviewer 2" and nothing more: generated content
// on the link itself would join its name. A room's masthead on a narrow screen shows the tile
// alone, and keeps the name for assistive technology (RoomPage.vue, ScreenPage.vue).
const { t } = useI18n();
</script>

<template>
  <RouterLink to="/" class="wordmark">
    <span class="tile" aria-hidden="true"></span>
    <span class="name">{{ t('app.name') }}</span>
  </RouterLink>
</template>

<style scoped>
.wordmark {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  color: var(--ink);
  font-family: var(--font-number);
  font-size: var(--text-xl);
  font-weight: var(--weight-display);
  text-decoration: none;
  white-space: nowrap;
}

.tile {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: var(--radius-card);
  background: var(--ink);
  color: var(--on-ink);
  font-size: var(--text-lg);
  line-height: 1;
}

.tile::before {
  content: 'R2';
}
</style>
