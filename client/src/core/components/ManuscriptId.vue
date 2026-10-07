<script setup lang="ts">
import { useI18n } from 'vue-i18n';

defineProps<{ code: string }>();
const { t } = useI18n();
</script>

<template>
  <span class="manuscript">
    <span class="label">{{ t('room.manuscript') }}</span>
    <span class="code">R2-{{ code }}</span>
  </span>
</template>

<style scoped>
.manuscript {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-2);
  white-space: nowrap;
}

.label {
  color: var(--ink-3);
  font-size: var(--text-xs);
  font-variant-caps: all-small-caps;
  letter-spacing: 0.06em;
}

.code {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  letter-spacing: 0.04em;
}
</style>
