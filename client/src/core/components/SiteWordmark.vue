<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';

// The site's name, with its "R2" tile: a link to the home page, or plain text on the language
// gate, where it is the title. The tile is drawn by CSS inside a span that assistive technology
// skips, so that the link reads as "Reviewer 2" and nothing more: generated content on the link
// itself would join its name. A `compact` wordmark, in a room's masthead, shows the tile alone
// on a narrow screen, and keeps the name for assistive technology.
withDefaults(defineProps<{ size?: 'medium' | 'large'; link?: boolean; compact?: boolean }>(), {
  size: 'medium',
  link: true,
  compact: false,
});
const { t } = useI18n();
</script>

<template>
  <component :is="link ? RouterLink : 'p'" :to="link ? '/' : undefined" class="wordmark" :class="[size, { compact }]">
    <span class="tile" aria-hidden="true"></span>
    <span class="name">{{ t('app.name') }}</span>
  </component>
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
  font-variant-numeric: tabular-nums;
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

.large {
  gap: var(--space-3);
  font-size: var(--text-3xl);
}

.large .tile {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-control);
  font-size: var(--text-xl);
}

/* On a narrow screen a room's masthead has room for the room's number and menu beside the
   tile, but not for the name. */
@media (max-width: 39.99rem) {
  .compact .name {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
}
</style>
