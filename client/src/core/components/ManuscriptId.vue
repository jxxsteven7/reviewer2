<script setup lang="ts">
import { formatCode } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';

// The room's number, as a pill: "Manuscript R2-K7QX".
defineProps<{ code: string }>();
const { t } = useI18n();
</script>

<template>
  <span class="manuscript">
    <span class="label">{{ t('room.manuscript') }}</span>
    <span class="code num">{{ formatCode(code) }}</span>
  </span>
</template>

<style scoped>
.manuscript {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 40px;
  padding: 0 var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--paper);
  white-space: nowrap;
}

.label {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.code {
  font-size: var(--text-lg);
  font-weight: var(--weight-display);
  letter-spacing: 0.06em;
}
</style>
