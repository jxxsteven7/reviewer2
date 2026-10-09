<script setup lang="ts">
import { ACCOUNT_API, type RecordsView } from '@reviewer2/shared';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { request } from '../account';

// The account's record: how many games it has finished in a seat and won, and the last 20, each
// with its game, its date, the group and the role, and the decision letter that the group got.
const { t, te, locale } = useI18n();
const records = ref<RecordsView | null>(null);

onMounted(async () => {
  const reply = await request<{ records: RecordsView }>(ACCOUNT_API.records);
  if (reply.ok) records.value = reply.records;
});

// A game's own words, where the locale files have them, and the stored word where they don't, as
// for a game that came later than this page.
const label = (key: string, fallback: string) => (te(key) ? t(key) : fallback);

function date(iso: string): string {
  try {
    return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}
</script>

<template>
  <div v-if="records" class="records">
    <p class="summary">{{ t('account.profile.recordSummary', { games: records.games, wins: records.wins }) }}</p>
    <p v-if="records.games === 0" class="note">{{ t('account.profile.noRecords') }}</p>
    <template v-else>
      <h3>{{ t('account.profile.recent') }}</h3>
      <ol class="list">
        <li v-for="(record, index) in records.recent" :key="index" class="record" :class="{ won: record.won }">
          <span class="when">{{ date(record.endedAt) }}</span>
          <span class="game">{{ label(`home.games.${record.game}.name`, record.game) }}</span>
          <span class="part">
            {{
              t('account.profile.recordLine', {
                side: label(`lobby.group.${record.side}`, record.side),
                role: label(`account.profile.roles.${record.role}`, record.role),
              })
            }}
          </span>
          <span class="verdict">{{ label(`game.letter.verdicts.${record.verdict}`, record.verdict) }}</span>
        </li>
      </ol>
    </template>
  </div>
</template>

<style scoped>
.records {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.summary {
  font-variant-numeric: tabular-nums;
}

.note {
  color: var(--ink-3);
  font-size: var(--text-sm);
}

h3 {
  color: var(--ink-2);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: 500;
}

.list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.record {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0 var(--space-3);
  padding: var(--space-2) 0;
  border-top: 1px solid var(--rule);
  font-size: var(--text-sm);
}

.when,
.part {
  color: var(--ink-3);
}

.game {
  grid-column: 1;
  font-weight: 500;
}

.verdict {
  grid-row: 1 / span 2;
  grid-column: 2;
  align-self: center;
  color: var(--ink-2);
}

.won .verdict {
  color: var(--ink);
  font-weight: 600;
}
</style>
