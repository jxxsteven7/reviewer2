<script setup lang="ts">
import { parseCode } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import { errorKey } from '../errors';
import { entry } from '../room';
import { connection } from '../socket';

// What a page shows while it isn't in its room: that the room is still opening, or that the server
// turned the page away and it will try again (socket.ts), that the room doesn't exist, that it has
// closed, or why entering it failed. A screen has no seat to lose, so one that the chair sent away
// is told how to come back; one that went with the seat of a removed player is told, as the player
// is, that there is no coming back. A guest whom a public room sent to log in gets the way to the
// account page, which brings them back here, to the room as its link names it, however the address
// gave the code.
const props = defineProps<{ screen?: boolean }>();
const { t } = useI18n();
const route = useRoute();
const signIn = computed(() => {
  if (entry.status !== 'failed' || entry.error !== 'account_required') return null;
  const code = parseCode(String(route.params.code));
  return { path: '/account', query: { next: code ? `/room/${code}${props.screen ? '/screen' : ''}` : route.path } };
});

const message = computed<{ title?: string; body: string } | null>(() => {
  switch (entry.status) {
    case 'not_found':
      return { title: t('room.notFound.title'), body: t('room.notFound.body') };
    case 'closed':
      return {
        body: t(
          props.screen && entry.closed === 'dismissed'
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
    <RouterLink v-if="signIn" :to="signIn" class="sign-in">{{ t('room.signIn') }}</RouterLink>
    <RouterLink to="/">{{ t('room.home') }}</RouterLink>
  </section>
  <p v-else class="loading">{{ t(connection.refusal ? errorKey(connection.refusal) : 'room.joining') }}</p>
</template>

<style scoped>
.notice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  max-width: var(--page-narrow);
  margin: var(--space-6) 0;
  padding: var(--space-5);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
}

h1 {
  font-size: var(--text-2xl);
}

.sign-in {
  font-weight: var(--weight-black);
}

.loading {
  padding: var(--space-7) 0;
  font-weight: var(--weight-bold);
}
</style>
