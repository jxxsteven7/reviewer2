<script setup lang="ts">
import type { RecordCounts } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { winRate } from '../rates';
import StatBlocks, { type StatBlock } from './StatBlocks.vue';

// An account's record as counts (docs/architecture.md#accounts), on the account's page and on its
// public page when its owner shows it: six numbers on small blocks of their own (StatBlocks.vue),
// the games finished, in matches or not, the share of them won (rates.ts), the share won as a
// group's PI and as a student, each over how many games, which count every game as the total does,
// the matches finished, and how many of them the account finished first, level with others too.
const props = defineProps<{ counts: RecordCounts }>();
const { t, locale } = useI18n();

const total = computed(() => {
  const { ordinary, inMatches } = props.counts;
  return { games: ordinary.games + inMatches.games, wins: ordinary.wins + inMatches.wins };
});
const blocks = computed<StatBlock[]>(() => {
  const { roles, matches } = props.counts;
  const role = (key: 'captain' | 'guesser'): StatBlock => ({
    label: t(`account.profile.recordStats.${key}`),
    value: winRate(roles[key].wins, roles[key].games, locale.value),
    detail: t('account.profile.recordStats.gameCount', { count: roles[key].games }, roles[key].games),
  });
  return [
    { label: t('account.profile.recordStats.games'), value: String(total.value.games) },
    { label: t('account.profile.recordStats.rate'), value: winRate(total.value.wins, total.value.games, locale.value) },
    role('captain'),
    role('guesser'),
    { label: t('account.profile.recordStats.matches'), value: String(matches.played) },
    { label: t('account.profile.recordStats.won'), value: String(matches.won) },
  ];
});
</script>

<template>
  <StatBlocks class="record-stats" :blocks="blocks" roles />
</template>
