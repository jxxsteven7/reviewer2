<script setup lang="ts">
import { ACCOUNT_API, type GameRecord, type RecordsView } from '@reviewer2/shared';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { games } from '../../games';
import { request } from '../account';
import UiButton from '../components/UiButton.vue';
import UiSheet from '../components/UiSheet.vue';
import { errorKey } from '../errors';
import { points } from '../points';
import { toastError } from '../toast';
import { useBusy } from '../useBusy';

// The account's record: how many games it has finished in a seat and won, and the last 20, each
// with its game, its date, the group and the role, and the decision letter that the group got;
// then how many matches it finished, and the last 20 of them, each with its place, its total and
// its title. A record that can't be fetched says so, with a way to try again. A game that the
// server kept to watch again opens in a sheet, in the game's own replay viewer.
const { t, te, locale } = useI18n();
const records = ref<RecordsView | null>(null);
const failed = ref<string | undefined>();
const { busy, run } = useBusy();

// The replay that is open, with the game it is of.
const replay = ref<{ game: string; data: unknown } | null>(null);

async function watchAgain(record: GameRecord): Promise<void> {
  const reply = await run(() => request<{ replay: unknown }>(ACCOUNT_API.replay, { gameId: record.gameId }));
  if (!reply) return;
  if (!reply.ok) {
    toastError(reply.error);
    return;
  }
  replay.value = { game: record.game, data: reply.replay };
}

async function load(): Promise<void> {
  const reply = await run(() => request<{ records: RecordsView }>(ACCOUNT_API.records));
  if (!reply) return;
  if (reply.ok) {
    records.value = reply.records;
    failed.value = undefined;
  } else {
    failed.value = t(errorKey(reply.error));
  }
}

onMounted(load);

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
          <UiButton
            v-if="record.replay && games[record.game]"
            class="watch"
            size="small"
            variant="quiet"
            :disabled="busy"
            @click="watchAgain(record)"
          >
            {{ t('account.profile.watchAgain') }}
          </UiButton>
        </li>
      </ol>
    </template>
    <template v-if="records.matches.played > 0">
      <p class="summary">{{ t('account.profile.matchSummary', { played: records.matches.played }) }}</p>
      <h3>{{ t('account.profile.recentMatches') }}</h3>
      <ol class="list">
        <li
          v-for="(match, index) in records.matches.recent"
          :key="`match-${index}`"
          class="record match"
          :class="{ won: match.title === 'best_paper' }"
        >
          <span class="when">{{ date(match.endedAt) }}</span>
          <span class="game">
            {{ label(`home.games.${match.game}.name`, match.game) }} &middot;
            {{ t('account.profile.matchGames', { games: match.games }) }}
          </span>
          <span class="part">
            {{
              t('account.profile.matchLine', { rank: match.rank, players: match.players, score: points(match.score) })
            }}
          </span>
          <span v-if="match.title" class="verdict">{{ t(`match.titleNames.${match.title}`) }}</span>
        </li>
      </ol>
    </template>
  </div>
  <div v-else-if="failed" class="records">
    <p class="problem" role="alert">{{ failed }}</p>
    <UiButton size="small" :disabled="busy" @click="load">{{ t('account.profile.recordsAgain') }}</UiButton>
  </div>
  <UiSheet :open="replay !== null" :title="t('replay.title')" @close="replay = null">
    <component :is="games[replay.game]?.Replay" v-if="replay" :replay="replay.data" />
  </UiSheet>
</template>

<style scoped>
.records {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.summary {
  font-weight: var(--weight-bold);
}

.problem {
  color: var(--red-deep);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.note {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

h3 {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
}

.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.record {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0 var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-card);
  background: var(--paper-2);
  font-size: var(--text-sm);
}

.record.won {
  background: var(--bg);
}

.when,
.part {
  color: var(--ink-2);
}

.game {
  grid-column: 1;
  font-weight: var(--weight-bold);
}

.verdict {
  grid-row: 1 / span 2;
  grid-column: 2;
  align-self: center;
  font-weight: var(--weight-bold);
}

.watch {
  grid-column: 1;
  justify-self: start;
  margin: var(--space-1) 0 0 calc(-1 * var(--space-2));
}

.won .verdict {
  font-weight: var(--weight-black);
}
</style>
