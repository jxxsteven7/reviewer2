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
/* One line of a fixed height, so that a game's clock can stick right under it (KeywordsGame). */
.banner {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  height: var(--banner-height);
  padding: 0 var(--space-4);
  overflow: hidden;
  background: var(--ink);
  color: var(--on-ink);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  white-space: nowrap;
}
</style>
