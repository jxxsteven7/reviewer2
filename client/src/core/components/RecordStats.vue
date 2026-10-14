<script setup lang="ts">
import type { RecordCounts } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

// An account's record as counts (docs/architecture.md#accounts), on the account's page and on its
// public page when its owner shows it: three numbers on blocks of their own, the games finished,
// in matches or not, the share of them won, as a whole percentage rounded down, so that 100% is a
// record without a loss, which a record without games doesn't have, and the matches finished, with
// how many of them the account finished first, level with others too; then a line of small type
// with the games outside matches and those in matches, each with its wins, leaving out a kind of
// which there are none.
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
const split = computed(() =>
  (['ordinary', 'inMatches'] as const)
    .filter((kind) => props.counts[kind].games > 0)
    .map((kind) => t(`account.profile.recordStats.${kind}`, props.counts[kind]))
    .join(' \u00b7 '),
);
</script>

<template>
  <div class="record-stats">
    <dl class="blocks">
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
        <dd v-if="counts.matches.played > 0" class="sub">
          {{ t('account.profile.recordStats.won', { won: counts.matches.won }) }}
        </dd>
      </div>
    </dl>
    <p v-if="split" class="split">{{ split }}</p>
  </div>
</template>

<style scoped>
.record-stats {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* Three blocks side by side, as wide as each other, at phone width too. */
.blocks {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
  margin: 0;
}

.block {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: var(--line-thin) solid var(--ink);
  border-radius: var(--radius-card);
  background: var(--paper);
}

dt {
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
}

dd {
  margin: 0;
}

.value {
  font-size: var(--text-2xl);
  font-weight: var(--weight-display);
  line-height: 1.2;
}

.sub {
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
}

.split {
  color: var(--ink-2);
  font-size: var(--text-xs);
}
</style>
