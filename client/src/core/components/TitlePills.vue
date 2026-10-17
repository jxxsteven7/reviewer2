<script setup lang="ts">
import type { ContributionCount, StreakKind, TitleCount } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import TitleInfo from './TitleInfo.vue';

// An account's titles, its streaks, named already (streaks.ts), and its feedback contributions of
// each kind, counted, as pills, each title with how many times it was won when that is more than once: on the
// account's own page and on its public page. A tap on a pill says what it is (TitleInfo.vue).
withDefaults(
  defineProps<{
    titles: TitleCount[];
    streaks?: { kind: StreakKind; length: number; title: string }[];
    contributions?: ContributionCount[] | null;
  }>(),
  { streaks: () => [], contributions: null },
);
const { t } = useI18n();

const counted = (label: string, count: number) =>
  count > 1 ? t('account.profile.titleCount', { title: label, count }) : label;
</script>

<template>
  <ul class="titles">
    <li v-for="{ title, count } in titles" :key="title">
      <TitleInfo :title="{ kind: 'award', title }" class="pill press press-small">
        {{ counted(t(`account.profile.titleNames.${title}`), count) }}
      </TitleInfo>
    </li>
    <li v-for="{ kind, length, title } in streaks" :key="kind">
      <TitleInfo
        :title="{ kind: 'streak', streak: kind, length, best: true }"
        class="pill streak press press-small"
        :class="kind"
      >
        {{ title }}
      </TitleInfo>
    </li>
    <li v-for="{ kind, count } in contributions ?? []" :key="kind">
      <TitleInfo :title="{ kind: 'contribution', contribution: kind }" class="pill press press-small">
        {{ counted(t('account.profile.contributed', { kind: t(`contributions.kinds.${kind}`) }), count) }}
      </TitleInfo>
    </li>
  </ul>
</template>

<style scoped>
.titles {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* A pill is a button that a tap opens, with the small hard shadow and the press of one. Its box
   reaches above and below it, out of sight, to 44px tall, centered on it; the rows are 12px apart,
   more than the box reaches on either side, so that no pill's box lies over another's. */
.titles .pill {
  position: relative;
  padding: var(--space-1) var(--space-3);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--bg);
  box-shadow: var(--shadow-0);
  font-weight: var(--weight-bold);
}

.titles .pill::before {
  content: '';
  position: absolute;
  inset: calc(50% - 22px) 0;
}

.titles .streak.wins {
  background: var(--blue-tint);
}

.titles .streak.losses {
  background: var(--red-tint);
}
</style>
