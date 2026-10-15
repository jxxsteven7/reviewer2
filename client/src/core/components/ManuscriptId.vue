<script setup lang="ts">
import { formatCode } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';

// The room's number, as a pill: "Manuscript R2-K7QX". A `tight` one shares a phone's masthead with
// two buttons, which leave no room for the English word, nor, on the narrowest phones, for the
// Chinese one or the pill's full padding: the number stands alone there, and screen readers still
// hear the word.
defineProps<{ code: string; tight?: boolean }>();
const { t } = useI18n();
</script>

<template>
  <span class="manuscript" :class="{ tight }">
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

@media (max-width: 39.99rem) {
  .tight:lang(en) .label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
}

@media (max-width: 23.12rem) {
  .tight {
    padding: 0 var(--space-3);
  }

  .tight .label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
}

/* On the narrowest phones, below about 350 px, the number keeps the least room around it. */
@media (max-width: 21.99rem) {
  .tight {
    padding: 0 var(--space-2);
  }
}
</style>
