<script setup lang="ts">
import type { AcknowledgmentCount, StreakKind, TitleCount } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';

// An account's titles, its streaks, named already (streaks.ts), and the acknowledgments counted
// for it, as pills, each title with how many times it was won when that is more than once: on the
// account's own page and on its public page.
withDefaults(
  defineProps<{
    titles: TitleCount[];
    streaks?: { kind: StreakKind; title: string }[];
    acknowledgments?: AcknowledgmentCount[] | null;
  }>(),
  { streaks: () => [], acknowledgments: null },
);
const { t } = useI18n();

const counted = (label: string, count: number) =>
  count > 1 ? t('account.profile.titleCount', { title: label, count }) : label;
</script>

<template>
  <ul class="titles">
    <li v-for="{ title, count } in titles" :key="title">
      {{ counted(t(`account.profile.titleNames.${title}`), count) }}
    </li>
    <li v-for="{ kind, title } in streaks" :key="kind" class="streak" :class="kind">{{ title }}</li>
    <li v-for="{ kind, count } in acknowledgments ?? []" :key="kind">
      {{ counted(t('account.profile.acknowledged', { kind: t(`acknowledgments.kinds.${kind}`) }), count) }}
    </li>
  </ul>
</template>

<style scoped>
.titles {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.titles li {
  padding: var(--space-1) var(--space-3);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--bg);
  font-weight: var(--weight-bold);
}

.titles .streak.wins {
  background: var(--blue-tint);
}

.titles .streak.losses {
  background: var(--red-tint);
}
</style>
