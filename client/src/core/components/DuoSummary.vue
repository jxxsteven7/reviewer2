<script setup lang="ts">
import type { DuoView } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { duoLine } from '../duos';
import TitleInfo from './TitleInfo.vue';

// What the account has played with one friend (docs/architecture.md#friend-duos): the games won and
// lost together and against each other, on one line, and the titles the friend holds among the
// account's friends, as badges that a tap explains. On the friends list and on the friend's
// public profile, for the account alone.
const props = defineProps<{ duo: DuoView }>();
const { t } = useI18n();
const line = computed(() => duoLine(t, props.duo));
</script>

<template>
  <span class="duo-summary">
    <span v-if="line" class="games">{{ line }}</span>
    <span v-if="duo.titles.length" class="badges">
      <TitleInfo
        v-for="title in duo.titles"
        :key="title"
        :title="{ kind: 'duo', duo: title }"
        class="badge press press-small"
      />
    </span>
  </span>
</template>

<style scoped>
.duo-summary {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
}

/* The line breaks only at its plain spaces, after the dot and between the words of the English
   copy: its no-break spaces keep each number with its word, and keep-all keeps the Chinese copy,
   which has no plain space, from breaking between two characters. */
.games {
  color: var(--ink-2);
  font-size: var(--text-sm);
  word-break: keep-all;
}

.badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-2);
}

/* A badge is a small pill with the small hard shadow and the press of a button, whose box reaches
   above and below it, out of sight, to 44px tall, centered on it; the rows are 12px apart, more
   than the box reaches on either side, so that no badge's box lies over another's. */
.badge {
  position: relative;
  padding: var(--space-1) var(--space-2);
  border: var(--line-thin) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--bg);
  box-shadow: var(--shadow-0);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.badge::before {
  content: '';
  position: absolute;
  inset: calc(50% - 22px) 0;
}
</style>
