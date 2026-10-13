<script setup lang="ts">
import type { RecordCounts } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

// An account's record as counts (docs/architecture.md#accounts), on the account's page and on its
// public page when its owner shows it: a table of the games finished outside matches, those
// finished in matches and all of them, each with how many were won and the share of wins, which a
// row without games doesn't have; then how many matches the account finished, and in how many it
// finished first, level with others too.
const props = defineProps<{ counts: RecordCounts }>();
const { t, locale } = useI18n();

const NO_RATE = '\u2014';

const rows = computed(() => {
  const { ordinary, inMatches } = props.counts;
  const total = { games: ordinary.games + inMatches.games, wins: ordinary.wins + inMatches.wins };
  const percent = new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 0 });
  return (
    [
      ['ordinary', ordinary],
      ['inMatches', inMatches],
      ['total', total],
    ] as const
  ).map(([key, { games, wins }]) => ({ key, games, wins, rate: games === 0 ? NO_RATE : percent.format(wins / games) }));
});
</script>

<template>
  <div class="record-table">
    <table>
      <thead>
        <tr>
          <td></td>
          <th scope="col">{{ t('account.profile.recordTable.games') }}</th>
          <th scope="col">{{ t('account.profile.recordTable.wins') }}</th>
          <th scope="col">{{ t('account.profile.recordTable.rate') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.key" :class="row.key">
          <th scope="row">{{ t(`account.profile.recordTable.${row.key}`) }}</th>
          <td class="num">{{ row.games }}</td>
          <td class="num">{{ row.wins }}</td>
          <td class="num">{{ row.rate }}</td>
        </tr>
      </tbody>
    </table>
    <p class="matches">
      {{
        counts.matches.played > 0
          ? t('account.profile.recordTable.matches', counts.matches)
          : t('account.profile.recordTable.noMatches')
      }}
    </p>
  </div>
</template>

<style scoped>
.record-table {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

th,
td {
  padding: var(--space-1) var(--space-2);
}

thead th {
  color: var(--ink-2);
  font-weight: var(--weight-bold);
  text-align: right;
}

tbody th {
  padding-left: 0;
  font-weight: var(--weight-bold);
  text-align: left;
}

tbody td {
  text-align: right;
}

td:last-child,
th:last-child {
  padding-right: 0;
}

/* The total, under a line, as a sum is. */
.total th,
.total td {
  border-top: var(--line) solid var(--ink);
  font-weight: var(--weight-black);
}

.matches {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}
</style>
