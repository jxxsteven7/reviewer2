<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { connection } from '../socket';

const { t } = useI18n();
</script>

<template>
  <p v-if="connection.everConnected && !connection.connected" class="banner" role="status">
    {{ t('room.reconnecting') }}
  </p>
</template>

<style scoped>
.banner {
  position: sticky;
  top: 0;
  z-index: 10;
  padding: var(--space-2) var(--space-4);
  background: var(--ink);
  color: var(--paper);
  font-size: var(--text-sm);
  text-align: center;
}
</style>
