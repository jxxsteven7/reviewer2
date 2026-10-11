<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { reconnecting } from '../socket';
import { dismiss, toasts } from '../toast';

// Short messages at the top of the screen. At the bottom they would cover a sheet's input, right
// where a player just tapped, or sit behind a phone's keyboard. While the "Reconnecting..." banner
// shows at the top, they move down below it.
const { t } = useI18n();
</script>

<template>
  <div class="toasts" :class="{ 'under-banner': reconnecting }" role="status" aria-live="polite">
    <button v-for="item in toasts" :key="item.id" type="button" class="toast" @click="dismiss(item.id)">
      {{ t(item.key, item.params) }}
    </button>
  </div>
</template>

<style scoped>
.toasts {
  --toasts-top: max(var(--space-4), calc(env(safe-area-inset-top) + var(--space-3)));

  position: fixed;
  top: var(--toasts-top);
  left: 50%;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: min(28rem, calc(100% - 2 * var(--space-4)));
  transform: translateX(-50%);
  pointer-events: none;
}

.toasts.under-banner {
  top: calc(var(--toasts-top) + var(--banner-height));
}

.toast {
  padding: var(--space-3) var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--ink);
  box-shadow: var(--shadow-1);
  color: var(--on-ink);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  text-align: left;
  cursor: pointer;
  pointer-events: auto;
}
</style>
