<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { dismiss, toasts } from '../toast';

const { t } = useI18n();
</script>

<template>
  <div class="toasts" role="status" aria-live="polite">
    <button v-for="item in toasts" :key="item.id" type="button" class="toast" @click="dismiss(item.id)">
      {{ t(item.key, item.params) }}
    </button>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  left: 50%;
  bottom: max(var(--space-5), calc(env(safe-area-inset-bottom) + var(--space-3)));
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: min(28rem, calc(100% - 2 * var(--space-4)));
  transform: translateX(-50%);
  pointer-events: none;
}

.toast {
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--ink);
  color: var(--paper);
  font-size: var(--text-sm);
  text-align: left;
  pointer-events: auto;
}
</style>
