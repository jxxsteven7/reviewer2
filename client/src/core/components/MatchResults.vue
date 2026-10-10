<script setup lang="ts">
import type { MatchRules, MatchView, RoomView } from '@reviewer2/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { points } from '../points';
import { act } from '../socket';
import { useBusy } from '../useBusy';
import MatchForm from './MatchForm.vue';
import PlayerAvatar from './PlayerAvatar.vue';
import UiButton from './UiButton.vue';
import UiSheet from './UiSheet.vue';

// The end of a match: everyone's place and total, the Best Paper Award for the first and the
// game's black hole for the last, with what the reviewers would say to them. A match that the chair
// ended early has places but no titles. The chair starts another match, with rules that they may
// change, or makes the room an ordinary one again.
const props = defineProps<{ room: RoomView }>();
const { t } = useI18n();
const { busy, run } = useBusy();

const match = computed(() => props.room.match as MatchView);
const isChair = computed(() => props.room.me !== null && props.room.chairId === props.room.me);

const choosing = ref(false);
const rules = ref<MatchRules>({ ...match.value.rules });
const rulesValid = ref(true);

function chooseAgain() {
  rules.value = { ...match.value.rules };
  choosing.value = true;
}

async function next(nextRules: MatchRules | null) {
  choosing.value = false;
  await run(() => act('room:matchNext', { matchId: match.value.id, match: nextRules }));
}
</script>

<template>
  <section class="match-results">
    <h2 class="heading">{{ match.status === 'over' ? t('match.over') : t('match.stopped') }}</h2>
    <p class="note">
      {{ t('match.gamesPlayed', { played: match.played, games: match.rules.games }) }}
      <template v-if="match.status === 'stopped'"> &middot; {{ t('match.stoppedNote') }}</template>
    </p>
    <ol class="ranking">
      <li
        v-for="(line, index) in match.standings"
        :key="line.playerId ?? `left-${index}`"
        :class="[line.title, { me: line.playerId !== null && line.playerId === room.me, left: line.left }]"
      >
        <span class="rank">{{ line.rank ?? '\u2013' }}</span>
        <PlayerAvatar :name="line.name" :avatar="line.avatar" :size="line.title ? 'medium' : 'small'" />
        <span class="who">
          <span class="name">
            {{ line.name }}
            <span v-if="line.left" class="mark">{{ t('match.left') }}</span>
          </span>
          <span v-if="line.title" class="title">{{ t(`match.titleNames.${line.title}`) }}</span>
          <span v-if="line.title === 'black_hole'" class="line">{{ t('match.blackHoleLine') }}</span>
        </span>
        <span class="total">{{ points(line.total) }}</span>
      </li>
    </ol>

    <div v-if="isChair" class="actions">
      <UiButton variant="primary" :disabled="busy" @click="chooseAgain">{{ t('match.again') }}</UiButton>
      <UiButton :disabled="busy" @click="next(null)">{{ t('match.ordinaryRoom') }}</UiButton>
    </div>
    <p v-else class="wait">{{ t('match.waitAgain') }}</p>

    <UiSheet :open="choosing" :title="t('match.again')" @close="choosing = false">
      <form class="again" @submit.prevent="rulesValid && next(rules)">
        <MatchForm v-model="rules" v-model:valid="rulesValid" />
        <UiButton variant="primary" type="submit" :disabled="busy || !rulesValid">{{
          t('match.againSubmit')
        }}</UiButton>
        <UiButton variant="quiet" @click="choosing = false">{{ t('lobby.manage.cancel') }}</UiButton>
      </form>
    </UiSheet>
  </section>
</template>

<style scoped>
.match-results {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  margin: var(--space-4) 0;
  padding: var(--space-4);
  border: 1px solid var(--ink);
  border-radius: var(--radius-card);
}

.heading {
  font-size: var(--text-2xl);
}

.note,
.wait {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.ranking {
  width: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ranking li {
  display: grid;
  grid-template-columns: 2rem auto 1fr auto;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--rule);
}

.rank {
  color: var(--ink-2);
  text-align: right;
}

.who {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.name {
  overflow-wrap: anywhere;
}

.me .name {
  font-weight: 600;
}

.left {
  color: var(--ink-3);
}

.mark {
  color: var(--ink-3);
  font-size: var(--text-xs);
}

.title {
  font-family: var(--font-serif);
  font-size: var(--text-lg);
  font-weight: 600;
}

.best_paper .title {
  color: var(--blue);
}

.black_hole .title {
  color: var(--red);
}

.line {
  color: var(--ink-2);
  font-family: var(--font-serif);
}

.line:lang(en) {
  font-style: italic;
}

.total {
  font-weight: 600;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.again {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
</style>
