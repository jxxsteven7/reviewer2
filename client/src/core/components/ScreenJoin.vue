<script setup lang="ts">
import { formatCode } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { roomLink } from '../room';
import QrCode from './QrCode.vue';

// How to join a room, on a big screen, in every game: the room's QR code and its number, with the
// hint under them in the waiting room, and `small` beside a game, without the hint.
const props = withDefaults(defineProps<{ code: string; small?: boolean }>(), { small: false });
const { t } = useI18n();
const link = computed(() => roomLink(props.code));
const number = computed(() => formatCode(props.code));
</script>

<template>
  <div class="join" :class="{ small }">
    <QrCode :text="link" :label="t('room.qrHint', { code: number })" />
    <p class="code num">{{ number }}</p>
    <p v-if="!small" class="hint">{{ t('room.qrHint', { code: number }) }}</p>
  </div>
</template>

<style scoped>
.join {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-5);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
  text-align: center;
}

.join :deep(.qr) {
  max-width: 20rem;
}

.join.small {
  padding: var(--space-4);
}

.join.small :deep(.qr) {
  max-width: 10rem;
}

.code {
  font-size: var(--text-3xl);
  font-weight: var(--weight-display);
  letter-spacing: 0.06em;
}

.hint {
  font-weight: var(--weight-bold);
}
</style>
