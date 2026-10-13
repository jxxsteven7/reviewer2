<script setup lang="ts">
import { ACCOUNT_API, type GameRecord, type RecordsView } from '@reviewer2/shared';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { games } from '../../games';
import { request } from '../account';
import RecordTable from '../components/RecordTable.vue';
import TitleInfo from '../components/TitleInfo.vue';
import UiButton from '../components/UiButton.vue';
import UiSheet from '../components/UiSheet.vue';
import { formatMoment } from '../dates';
import { errorKey } from '../errors';
import { points } from '../points';
import { toastError } from '../toast';
import { useBusy } from '../useBusy';

// The account's record: the table of how many games it has finished in a seat and won, outside
// matches and in them, with the matches it finished and won (RecordTable.vue); then the last 20
// games, each with its game, its date, which game of its match it was, if it was one, the group and
// the role, and the decision letter that the group got; then the last 20 matches, each with its
// place, its total and its title. A tap on a decision or a title says what it means
// (TitleInfo.vue). A record that can't be fetched says so, with a way to try again. A game that the
// server kept to watch again opens in a sheet, in the game's own replay viewer.
const { t, te, locale } = useI18n();
const records = ref<RecordsView | null>(null);
// Every game on the record, in matches or not.
const played = computed(() => (records.value ? records.value.ordinary.games + records.value.inMatches.games : 0));
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

const date = (iso: string) => formatMoment(iso, locale.value);

// Whether the locale files explain the decision, as they do for every decision of the first game.
const explained = (verdict: string) => te(`game.letter.explain.${verdict}`);
</script>

<template>
  <div v-if="records" class="records">
    <RecordTable :counts="records" />
    <p v-if="played === 0" class="note">{{ t('account.profile.noRecords') }}</p>
    <template v-else>
      <h3>{{ t('account.profile.recent') }}</h3>
      <ol class="list">
        <li v-for="(record, index) in records.recent" :key="index" class="record" :class="{ won: record.won }">
          <span class="when">{{ date(record.endedAt) }}</span>
          <span class="game">
            {{ label(`home.games.${record.game}.name`, record.game) }}
            <span v-if="record.match" class="tag">{{ t('account.profile.matchTag', record.match) }}</span>
          </span>
          <span class="part">
            {{
              t('account.profile.recordLine', {
                side: label(`lobby.group.${record.side}`, record.side),
                role: label(`account.profile.roles.${record.role}`, record.role),
              })
            }}
          </span>
          <TitleInfo
            v-if="explained(record.verdict)"
            :title="{ kind: 'verdict', verdict: record.verdict }"
            class="verdict"
          />
          <span v-else class="verdict">{{ label(`game.letter.verdicts.${record.verdict}`, record.verdict) }}</span>
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
          <TitleInfo v-if="match.title" :title="{ kind: 'award', title: match.title }" class="verdict">{{
            t(`match.titleNames.${match.title}`)
          }}</TitleInfo>
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

/* A game of a match says so, in a small tag after the game's name. */
.tag {
  margin-left: var(--space-1);
  padding: 0 var(--space-2);
  border: var(--line-thin) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--paper);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  white-space: nowrap;
}

.verdict {
  grid-row: 1 / span 2;
  grid-column: 2;
  align-self: center;
  font-weight: var(--weight-bold);
}

/* A decision that a tap explains is 44px tall to tap. */
button.verdict {
  min-height: 44px;
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
