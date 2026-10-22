<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { ballotRows, reportLine, reportRows } from './rows';
import SeatAvatar from './SeatAvatar.vue';
import type { RoundRecord } from './seats';
import VoteRows from './VoteRows.vue';

// One round of the hidden word game, as the record and the replay show it: every line of the
// round, a beige row each with the number's avatar, the viewer's own yellow, and a line added by a
// player tied for the most votes marked so; then each vote, as everyone saw it revealed
// (VoteRows.vue), and each report that was judged in the round. The small avatars open nothing.
defineProps<{ record: RoundRecord; mine: number | null }>();
const { t } = useI18n();
</script>

<template>
  <div class="round-body">
    <ul v-if="record.lines.length" class="lines">
      <li v-for="line in record.lines" :key="`${line.number}-${line.tie}`" :class="{ own: line.number === mine }">
        <SeatAvatar :number="line.number" />
        <span class="text" :class="{ none: line.text === null }">{{
          line.text ?? t('games.impostor.seat.noLine')
        }}</span>
        <span v-if="line.tie" class="tie">{{ t('games.impostor.record.tieLine') }}</span>
      </li>
    </ul>
    <p v-else class="empty">{{ t('games.impostor.record.noLines') }}</p>
    <section v-for="ballot in record.ballots" :key="ballot.ballot" class="ballot">
      <h4 class="label">{{ t(`games.impostor.record.ballots.${ballot.ballot}`) }}</h4>
      <VoteRows :rows="ballotRows(t, ballot)" />
    </section>
    <section v-for="report in record.reports" :key="`${report.by}-${report.target}`" class="ballot">
      <h4 class="label">{{ t(report.passed ? 'games.impostor.report.passed' : 'games.impostor.report.failed') }}</h4>
      <p class="report">{{ reportLine(t, report) }}</p>
      <VoteRows :rows="reportRows(t, report)" />
    </section>
  </div>
</template>

<style scoped>
.round-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.lines {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* A line of the round as a chat's row: beige, the viewer's own yellow. */
.lines li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-card);
  background: var(--paper-2);
  overflow-wrap: anywhere;
}

.lines li.own {
  background: var(--bg);
}

.text {
  flex: 1;
  min-width: 0;
  font-weight: var(--weight-bold);
}

.text.none {
  color: var(--ink-2);
}

.tie {
  flex: none;
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
}

.ballot {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.label {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
}

.report,
.empty {
  color: var(--ink-2);
  font-size: var(--text-sm);
}
</style>
