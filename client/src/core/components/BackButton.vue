<script lang="ts">
// Whether the page has a page on the site to go back to. The router keeps the address of the page
// before in the history's state (`back`), and none for the first page of a visit.
export const canGoBack = (): boolean => typeof (window.history.state as { back?: unknown } | null)?.back === 'string';
</script>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

// The way back to the page that the viewer came from on the site (docs/architecture.md#public-profiles):
// a round button with an arrow, as a sheet's close button is round with a cross. A page opened on
// its own, as from a shared link, a mail or a new tab, has nothing on the site to go back to, and
// no button: the wordmark at the top leads home.
const { t } = useI18n();
const previous = canGoBack();
const back = () => window.history.back();
</script>

<template>
  <button v-if="previous" type="button" class="back-button" :aria-label="t('account.back')" @click="back">
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 4.5 7.5 12l7.5 7.5" /></svg>
  </button>
</template>

<style scoped>
.back-button {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: var(--line) solid var(--ink);
  border-radius: 50%;
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
}

.back-button:active {
  background: var(--bg);
}

svg {
  width: 24px;
  height: 24px;
  fill: none;
  stroke: currentcolor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2.4;
}
</style>
