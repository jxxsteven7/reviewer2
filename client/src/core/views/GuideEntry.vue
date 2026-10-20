<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { GUIDE_PATH } from '../guide/progress';

// The way into the tutorial (docs/architecture.md#the-tutorial) in a game's card on the home page,
// for a guest and for an account that hasn't played the game yet: a green sticker with a cap, which
// says what the tutorial is, above the button for a new room.
const { t } = useI18n();
</script>

<template>
  <RouterLink class="guide-entry press" :to="GUIDE_PATH">
    <span class="cap" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M2 9.5 12 5l10 4.5-10 4.5Z" />
        <path d="M6.5 11.6v4.2c0 1.5 2.5 2.7 5.5 2.7s5.5-1.2 5.5-2.7v-4.2" />
        <path d="M21 10v5" />
      </svg>
    </span>
    <span class="text">
      <span class="main">{{ t('guide.entry.title') }}</span>
      <span class="sub">{{ t('guide.entry.hint') }}</span>
    </span>
    <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
  </RouterLink>
</template>

<style scoped>
.guide-entry {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0 var(--space-3);
  width: 100%;
  min-height: 64px;
  padding: var(--space-2) var(--space-4) var(--space-2) var(--space-3);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--go);
  box-shadow: var(--shadow-1);
  color: var(--ink);
  text-decoration: none;
}

.cap {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: var(--line) solid var(--ink);
  border-radius: 50%;
  background: var(--paper);
  box-shadow: var(--shadow-1);
}

.cap svg,
.chevron {
  fill: none;
  stroke: var(--ink);
  stroke-linecap: round;
  stroke-linejoin: round;
}

.cap svg {
  width: 24px;
  height: 24px;
  stroke-width: 2;
}

.text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.main {
  font-size: var(--text-lg);
  font-weight: var(--weight-black);
  line-height: 1.25;
}

.sub {
  font-size: var(--text-sm);
  line-height: 1.35;
}

.chevron {
  width: 20px;
  height: 20px;
  stroke-width: 2.6;
}
</style>
