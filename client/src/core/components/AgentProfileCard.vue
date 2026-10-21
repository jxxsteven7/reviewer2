<script setup lang="ts">
import {
  ACCOUNT_API,
  type AgentGameCounts,
  type AgentPersona,
  type AgentProfileView,
  type KeywordsAgentFeats,
} from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { account, request } from '../account';
import { errorKey } from '../errors';
import { winRate } from '../rates';
import { RECORDS_GAME } from '../records';
import PlayerAvatar from './PlayerAvatar.vue';
import PlayerNumber from './PlayerNumber.vue';
import StatBlocks, { type StatBlock } from './StatBlocks.vue';

// The page of an AI player (docs/architecture.md#ai-players), in the panel that a tap on its
// avatar opens in a room: player number 0, how many of it are in the rooms right now, and what it
// has done in the games of the first game that finished (RECORDS_GAME), as counts: the games, and the share of its seats in them
// that it won, in all and as a PI and as a student, on blocks as a player's record shows them
// (StatBlocks.vue), each over how many seats, since in a practice room it sits in both groups of
// one game; then what its clues found and the rest, line by line; and, for an account, what the
// viewer has played with it, which nobody else is sent.
const props = defineProps<{ persona: AgentPersona }>();
const { t, n, locale } = useI18n();
const profile = ref<AgentProfileView | null>(null);
const failed = ref<string | undefined>();

async function load(): Promise<void> {
  const reply = await request<{ profile: AgentProfileView }>(`${ACCOUNT_API.agents}${props.persona}`);
  if (reply.ok) {
    profile.value = reply.profile;
    failed.value = undefined;
  } else if (profile.value === null) {
    failed.value = reply.error;
  }
}

watch(
  () => props.persona,
  () => {
    profile.value = null;
    failed.value = undefined;
    void load();
  },
  { immediate: true },
);
// What the viewer has played with it is the viewer's, so the page is read again when the browser
// logs in or out.
watch(
  () => (account.loaded ? (account.summary?.handle ?? null) : undefined),
  (now, before) => {
    if (before !== undefined && now !== before && profile.value !== null) void load();
  },
);

const name = computed(() => t(`agents.personas.${props.persona}`));
// What it has done in the game shown, which is nothing for an AI that has played none of it, and
// what the game counts of its seats.
const shown = computed<AgentGameCounts>(
  () =>
    profile.value?.games[RECORDS_GAME] ?? {
      games: 0,
      seats: 0,
      wins: 0,
      roles: {},
      takeovers: 0,
      feats: null,
      you: null,
    },
);
const feats = computed(
  () => (shown.value.feats as KeywordsAgentFeats | null) ?? { clues: 0, found: 0, reviewer2: 0, best: null },
);
const blocks = computed<StatBlock[]>(() => {
  if (profile.value === null) return [];
  const { games, seats, wins, roles } = shown.value;
  const rate = (label: string, won: number, over: number): StatBlock => ({
    label: t(`account.profile.recordStats.${label}`),
    value: winRate(won, over, locale.value),
    detail: t('account.profile.recordStats.seatCount', { count: over }, over),
  });
  return [
    { label: t('account.profile.recordStats.games'), value: String(games) },
    rate('rate', wins, seats),
    rate('captain', roles.captain?.wins ?? 0, roles.captain?.seats ?? 0),
    rate('guesser', roles.guesser?.wins ?? 0, roles.guesser?.seats ?? 0),
  ];
});
// Cards found per clue, to one decimal place.
const perClue = computed(() =>
  feats.value.clues > 0
    ? n(feats.value.found / feats.value.clues, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : null,
);
const you = computed(() => {
  const mine = shown.value.you;
  return mine && Object.values(mine).some((count) => count > 0) ? mine : null;
});
</script>

<template>
  <div class="agent-card">
    <p v-if="failed" class="hint">{{ t(errorKey(failed)) }}</p>
    <p v-else-if="profile === null" class="hint">{{ t('playerPage.loading') }}</p>
    <template v-else>
      <div class="head">
        <PlayerAvatar :name="name" agent size="large" />
        <div class="who">
          <span class="name">{{ name }}</span>
          <PlayerNumber :id="profile.number" />
          <span class="live">{{
            profile.live.players > 0 ? t('agents.profile.live', profile.live) : t('agents.profile.liveNone')
          }}</span>
        </div>
      </div>

      <p class="bio">{{ t(`agents.profile.bio.${profile.persona}`) }}</p>

      <section v-if="you" class="you" aria-labelledby="agent-you">
        <h3 id="agent-you">{{ t('playerPage.duo', { name }) }}</h3>
        <ul>
          <li v-if="you.wonTogether + you.lostTogether > 0" class="num">
            {{ t('agents.profile.together', { won: you.wonTogether, lost: you.lostTogether }) }}
          </li>
          <li v-if="you.beat + you.beaten > 0" class="num">
            {{ t('agents.profile.against', { won: you.beat, lost: you.beaten }) }}
          </li>
          <li v-if="you.takenOver > 0" class="num">{{ t('agents.profile.takenOver', { count: you.takenOver }) }}</li>
        </ul>
      </section>

      <p v-if="shown.games === 0 && shown.takeovers === 0" class="hint">{{ t('agents.profile.none') }}</p>
      <StatBlocks v-else class="record-stats" :blocks="blocks" />
      <ul v-if="shown.games > 0 || shown.takeovers > 0" class="stats">
        <li v-if="perClue !== null" class="num">{{ t('agents.profile.perClue', { average: perClue }) }}</li>
        <li v-if="feats.best" class="num">{{ t('agents.profile.best', feats.best, feats.best.found) }}</li>
        <li class="num">{{ t('agents.profile.reviewer2', { count: feats.reviewer2 }) }}</li>
        <li class="num">{{ t('agents.profile.takeovers', { count: shown.takeovers }) }}</li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.agent-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.hint,
.live {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.who {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.name {
  font-size: var(--text-xl);
  font-weight: var(--weight-black);
  overflow-wrap: anywhere;
}

.bio {
  overflow-wrap: anywhere;
}

.stats,
.you ul {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.stats {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

/* What the viewer has played with it, set apart from what everyone sees, as a friend's is on a
   player's page (ProfileCard.vue). */
.you {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-card);
  background: var(--bg);
}

.you h3 {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
}

.you li {
  font-size: var(--text-sm);
}
</style>
