<script setup lang="ts">
import { ACCOUNT_API, type GameRecord, type RecordsView } from '@reviewer2/shared';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { games } from '../../games';
import { request } from '../account';
import AgentIcon from '../components/AgentIcon.vue';
import RecordStats from '../components/RecordStats.vue';
import TitleInfo from '../components/TitleInfo.vue';
import UiButton from '../components/UiButton.vue';
import UiSheet from '../components/UiSheet.vue';
import { formatStamp } from '../dates';
import { errorKey } from '../errors';
import { points } from '../points';
import { toastError } from '../toast';
import { useBusy } from '../useBusy';

// The account's record: the numbers of games, wins and matches (RecordStats.vue); then the last 20
// games, a line each: when it ended, in numbers, whether it was an ordinary game or which game of
// its match, or, for a game that an AI played in, which is never one of a match, the robot's head
// and "AI" in their place, which a tap explains, the role on a chip in the group's tint, and the
// decision that the group got, by its short English name in every language, with a round button
// on the right to watch it again; then
// the last 20 matches, in the same look, each with its games, its place and total, and its title on
// the right. The columns of a list line up from one line to the next where the browser has
// subgrids. What doesn't fit, a long decision or title, is cut short with an ellipsis; a tap on it
// says what it means, in full (TitleInfo.vue). A record that can't be fetched says so, with a way
// to try again. A game that the server kept to watch again opens in a sheet, in the game's own
// replay viewer.
const { t, te } = useI18n();
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

const stamp = (iso: string) => formatStamp(iso);
const moment = (iso: string) => {
  const { day, time } = formatStamp(iso);
  return `${day} ${time}`;
};
const role = (record: GameRecord) => label(`account.profile.roles.${record.role}`, record.role);
// The decision by its short name, where the locale files have one, as they do for the first game.
const short = (verdict: string) =>
  label(`game.letter.short.${verdict}`, label(`game.letter.verdicts.${verdict}`, verdict));

// Whether the locale files explain the decision, as they do for every decision of the first game.
const explained = (verdict: string) => te(`game.letter.explain.${verdict}`);
</script>

<template>
  <div v-if="records" class="records">
    <RecordStats :counts="records" />
    <p v-if="played === 0" class="note">{{ t('account.profile.noRecords') }}</p>
    <template v-else>
      <h3>{{ t('account.profile.recent') }}</h3>
      <ol class="list games">
        <li v-for="(record, index) in records.recent" :key="index" class="record" :class="{ won: record.won }">
          <span class="when num"
            ><span>{{ stamp(record.endedAt).day }}</span> <span>{{ stamp(record.endedAt).time }}</span></span
          >
          <TitleInfo v-if="record.agents" :title="{ kind: 'agents' }" class="tag agents"
            ><AgentIcon /><span aria-hidden="true">{{ t('room.agent') }}</span
            ><span class="sr-only">{{ t('account.profile.agentsTag') }}</span></TitleInfo
          >
          <span v-else class="tag">{{
            record.match ? t('account.profile.matchTag', record.match) : t('account.profile.ordinaryTag')
          }}</span>
          <span class="outcome">
            <span class="role" :class="record.side"
              ><span class="sr-only">{{
                t('account.profile.recordLine', {
                  side: label(`lobby.group.${record.side}`, record.side),
                  role: role(record),
                })
              }}</span
              ><span aria-hidden="true">{{ role(record) }}</span></span
            >
            <TitleInfo
              v-if="explained(record.verdict)"
              :title="{ kind: 'verdict', verdict: record.verdict }"
              class="verdict"
              >{{ short(record.verdict) }}</TitleInfo
            >
            <span v-else class="verdict">{{ short(record.verdict) }}</span>
          </span>
          <button
            v-if="games[record.game]"
            type="button"
            class="watch"
            :disabled="busy"
            :aria-label="t('account.profile.watchAgainOf', { when: moment(record.endedAt) })"
            @click="watchAgain(record)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5Z" /></svg>
          </button>
        </li>
      </ol>
    </template>
    <template v-if="records.matches.played > 0">
      <h3>{{ t('account.profile.recentMatches') }}</h3>
      <ol class="list matches">
        <li
          v-for="(match, index) in records.matches.recent"
          :key="`match-${index}`"
          class="record match"
          :class="{ won: match.title === 'best_paper' }"
        >
          <span class="when num"
            ><span>{{ stamp(match.endedAt).day }}</span> <span>{{ stamp(match.endedAt).time }}</span></span
          >
          <span class="tag">{{ t('account.profile.matchGames', match.games) }}</span>
          <span class="part">{{
            t(
              'account.profile.matchLine',
              { rank: match.rank, players: match.players, score: points(match.score) },
              Math.abs(match.score),
            )
          }}</span>
          <TitleInfo v-if="match.title" :title="{ kind: 'award', title: match.title }" class="verdict award">{{
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
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* A game or a match on one line: when it ended, a tag, the role or the place, the decision or the
   title, and, for a game kept to watch again, a round button on the right. */
.record {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
  border-radius: var(--radius-card);
  background: var(--paper-2);
  font-size: var(--text-sm);
  white-space: nowrap;
}

.record > * {
  flex: none;
}

.record.won {
  background: var(--bg);
}

/* A match's line ends in its title, a word, which keeps the inset its start has; a game's ends in
   the round button, which needs less. */
.record.match {
  padding-right: var(--space-3);
}

/* The lines of a list share its columns, so that the tags, the roles and the places start at the
   same place on every line, each column as wide as its widest entry. The decision follows its role
   on the same line, rather than in a column of its own: that lines the decisions up where the roles
   are as wide as each other, as in Chinese, and leaves the decision its room where they aren't, as
   in English, where "Student" is far wider than "PI". */
@supports (grid-template-columns: subgrid) {
  .list {
    display: grid;
    column-gap: var(--space-2);
  }

  .list.games {
    grid-template-columns: auto auto minmax(0, 1fr) auto;
  }

  .list.matches {
    grid-template-columns: auto auto auto minmax(0, 1fr);
  }

  .record {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
  }
}

/* The day over the time on a phone, beside it on a wider screen. */
.when {
  display: inline-flex;
  flex-direction: column;
  color: var(--ink-2);
  font-size: 11px;
  font-weight: var(--weight-bold);
  line-height: 1.15;
}

@media (min-width: 40rem) {
  .when {
    flex-direction: row;
    gap: 0.4em;
    font-size: var(--text-xs);
  }
}

.part {
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
}

/* Whether it was an ordinary game or one of a match, in a small tag, as snug as the role's, so
   that a phone has room for the decision after them. */
.tag {
  justify-self: start;
  padding: 0 6px;
  border: var(--line-thin) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--paper);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
}

/* A game that an AI played in has the robot's head and "AI" in its tag, the word underlined as a
   button that a tap explains is (TitleInfo.vue), which reaches 44px high to tap, out of sight. */
.tag.agents {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.tag.agents::before {
  content: '';
  position: absolute;
  inset: calc(50% - 22px) 0;
}

/* The role and the decision, together on the line, the decision cut short where they have no room. */
.outcome {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

/* The role, in the tint of the group's color, which the chip says to a screen reader too. */
.role {
  flex: none;
  justify-self: start;
  padding: 0 6px;
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  font-weight: var(--weight-black);
  line-height: 1.6;
}

.role.red {
  background: var(--red-tint);
  color: var(--red-deep);
}

.role.blue {
  background: var(--blue-tint);
  color: var(--blue-deep);
}

/* The decision, after the rest, and a match's title, on the right; either is cut short where the
   line has no room for it. */
.verdict {
  flex: 0 1 auto;
  justify-self: start;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  font-weight: var(--weight-bold);
  text-overflow: ellipsis;
}

.verdict.award {
  justify-self: end;
  margin-left: auto;
}

/* A decision that a tap explains reaches 44px high to tap, out of sight. */
button.verdict {
  position: relative;
}

button.verdict::before {
  content: '';
  position: absolute;
  inset: calc(50% - 22px) 0;
}

.won .verdict {
  font-weight: var(--weight-black);
}

/* Watching the game again: a round button on the right, as large as a finger where it can't be
   seen. */
.watch {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin-left: auto;
  padding: 0;
  border: var(--line-thin) solid var(--ink);
  border-radius: 50%;
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
}

.watch::before {
  content: '';
  position: absolute;
  inset: -6px;
}

.watch:disabled {
  cursor: default;
  opacity: 0.5;
}

.watch svg {
  width: 14px;
  height: 14px;
  margin-left: 2px;
  fill: currentcolor;
}
</style>
