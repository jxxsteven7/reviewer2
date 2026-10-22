<script setup lang="ts">
import { useI18n } from 'vue-i18n';

// What the players have said since the game ended, under a replay that the results page shows, as
// the chat shows it: beige rows, the name in bold before the text.
defineProps<{ talk: readonly { id: number | string; name: string; text: string }[] }>();
const { t } = useI18n();
</script>

<template>
  <section v-if="talk.length > 0" class="talk">
    <h3 class="section-title">{{ t('replay.talk') }}</h3>
    <p v-for="line in talk" :key="line.id" class="line">
      <span class="name">{{ line.name }}</span>
      <span>{{ line.text }}</span>
    </p>
  </section>
</template>

<style scoped>
.talk {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.line {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-card);
  background: var(--paper-2);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.name {
  margin-right: var(--space-2);
  font-weight: var(--weight-black);
}
</style>
