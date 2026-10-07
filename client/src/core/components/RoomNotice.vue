<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { errorKey } from '../errors';
import { entry } from '../room';

// What a page shows while it isn't in its room: that the room is still opening, that it doesn't
// exist, that it has closed, or why entering it failed. A screen has no seat to lose, so one that
// the chair sent away is told how to come back.
const props = defineProps<{ screen?: boolean }>();
const { t } = useI18n();

const message = computed<{ title?: string; body: string } | null>(() => {
  switch (entry.status) {
    case 'not_found':
      return { title: t('room.notFound.title'), body: t('room.notFound.body') };
    case 'closed':
      return {
        body: t(
          props.screen && entry.closed === 'removed'
            ? 'room.screenRemoved'
            : `room.closed.${entry.closed ?? 'expired'}`,
        ),
      };
    case 'failed':
      return { body: t(errorKey(entry.error ?? 'unknown')) };
    default:
      return null;
  }
});
</script>

<template>
  <section v-if="message" class="notice">
    <h1 v-if="message.title">{{ message.title }}</h1>
    <p>{{ message.body }}</p>
    <RouterLink to="/">{{ t('room.home') }}</RouterLink>
  </section>
  <p v-else class="loading">{{ t('room.joining') }}</p>
</template>

<style scoped>
.notice {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-7) 0;
}

h1 {
  font-size: var(--text-2xl);
}

p {
  color: var(--ink-2);
}

.loading {
  padding: var(--space-7) 0;
  color: var(--ink-3);
}
</style>
