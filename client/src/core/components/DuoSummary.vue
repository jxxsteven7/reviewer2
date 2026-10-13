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
  <span class="duo">
    <span v-if="line" class="games">{{ line }}</span>
    <span v-if="duo.titles.length" class="badges">
      <TitleInfo v-for="title in duo.titles" :key="title" :title="{ kind: 'duo', duo: title }" class="badge" />
    </span>
  </span>
</template>

<style scoped>
.duo {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
}

.games {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

/* A badge is a small pill whose box reaches past it, out of sight, so that it is 44px tall to tap. */
.badge {
  position: relative;
  padding: 0 var(--space-2);
  border: var(--line-thin) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--bg);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.badge::before {
  content: '';
  position: absolute;
  inset: -10px 0;
}
</style>
