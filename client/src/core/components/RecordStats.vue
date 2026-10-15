<script setup lang="ts">
import type { RecordCounts } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

// An account's record as counts (docs/architecture.md#accounts), on the account's page and on its
// public page when its owner shows it: four numbers on small blocks of their own, the games finished,
// in matches or not, the share of them won, as a whole percentage rounded down, so that 100% is a
// record without a loss, which a record without games doesn't have, the matches finished, and how
// many of them the account finished first, level with others too.
const props = defineProps<{ counts: RecordCounts }>();
const { t, locale } = useI18n();

const NO_RATE = '\u2014';

const total = computed(() => {
  const { ordinary, inMatches } = props.counts;
  return { games: ordinary.games + inMatches.games, wins: ordinary.wins + inMatches.wins };
});
const rate = computed(() => {
  const { games, wins } = total.value;
  const percent = new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 0 });
  return games === 0 ? NO_RATE : percent.format(Math.floor((wins * 100) / games) / 100);
});
</script>

<template>
  <dl class="record-stats">
    <div class="block">
      <dt>{{ t('account.profile.recordStats.games') }}</dt>
      <dd class="value num">{{ total.games }}</dd>
    </div>
    <div class="block">
      <dt>{{ t('account.profile.recordStats.rate') }}</dt>
      <dd class="value num">{{ rate }}</dd>
    </div>
    <div class="block">
      <dt>{{ t('account.profile.recordStats.matches') }}</dt>
      <dd class="value num">{{ counts.matches.played }}</dd>
    </div>
    <div class="block">
      <dt>{{ t('account.profile.recordStats.won') }}</dt>
      <dd class="value num">{{ counts.matches.won }}</dd>
    </div>
  </dl>
</template>

<style scoped>
/* Four blocks side by side, as wide as each other, at phone width too. */
.record-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-2);
  margin: 0;
}

.block {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
  padding: var(--space-1) var(--space-2);
  border: var(--line-thin) solid var(--ink);
  border-radius: var(--radius-card);
  background: var(--paper);
}

dt {
  max-width: 100%;
  overflow: hidden;
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

dd {
  margin: 0;
}

.value {
  font-size: var(--text-xl);
  font-weight: var(--weight-display);
  line-height: 1.2;
}
</style>
