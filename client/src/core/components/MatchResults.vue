<script setup lang="ts">
import type { MatchRules } from '@reviewer2/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { points } from '../points';
import type { ShownMatch, ShownRoom } from '../room';
import { act } from '../socket';
import { useBusy } from '../useBusy';
import MatchForm from './MatchForm.vue';
import AvatarButton from './AvatarButton.vue';
import TitleInfo from './TitleInfo.vue';
import UiButton from './UiButton.vue';
import UiSheet from './UiSheet.vue';

// The end of a match: everyone's place and total, the Best Paper Award for the first and the
// game's black hole for the last, with what the reviewers would say to them. A match that the chair
// ended early has places but no titles, and a tap on a title says what it is (TitleInfo.vue),
// except on a screen, which nobody taps. The chair starts another match, with rules that they may
// change, or makes the room an ordinary one again.
const props = defineProps<{ room: ShownRoom }>();
// A line's player while they are still in the room, whose panel a tap on the avatar opens.
const inRoom = (id: string | null) =>
  id !== null && props.room.players.some((player) => player.id === id) ? id : null;
const { t } = useI18n();
const { busy, run } = useBusy();

const match = computed(() => props.room.match as ShownMatch);
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
        <span class="rank num">{{ line.rank ?? '\u2013' }}</span>
        <AvatarButton
          :player-id="inRoom(line.playerId)"
          :name="line.name"
          :username="line.username"
          :guest="line.guest"
          :avatar="line.avatar"
          size="medium"
        />
        <span class="who">
          <span class="name">
            {{ line.name }}
            <span v-if="line.left" class="mark">{{ t('match.left') }}</span>
          </span>
          <TitleInfo
            v-if="line.title"
            :title="{ kind: 'award', title: line.title }"
            :still="room.me === null"
            class="title"
            >{{ t(`match.titleNames.${line.title}`) }}</TitleInfo
          >
          <span v-if="line.title === 'black_hole'" class="line">{{ t('match.blackHoleLine') }}</span>
        </span>
        <span class="total num">{{ points(line.total) }}</span>
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
  margin: var(--space-3) 0;
  padding: var(--space-5) var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-hero);
  background: var(--paper);
  box-shadow: var(--shadow-3);
}

.heading {
  font-size: var(--text-3xl);
}

.note,
.wait {
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.ranking {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Each player on a block; the first and the last, who get the titles, on the table's yellow. */
.ranking li {
  display: grid;
  grid-template-columns: 2rem auto 1fr auto;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-card);
  background: var(--paper-2);
}

.ranking .best_paper,
.ranking .black_hole {
  background: var(--bg);
}

.rank {
  font-size: var(--text-lg);
  font-weight: var(--weight-display);
  text-align: right;
}

.who {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.name {
  font-weight: var(--weight-bold);
  overflow-wrap: anywhere;
}

.me .name {
  font-weight: var(--weight-black);
}

.left {
  color: var(--ink-2);
}

.mark {
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--ink);
  color: var(--on-ink);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  line-height: 1.6;
}

/* The title is one line of display type. As a button (TitleInfo.vue), its box reaches above and
   below it, out of sight, to 44px tall, centered on it; the name above and the line below open
   nothing. */
.title {
  position: relative;
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--weight-display);
  font-synthesis: none;
}

button.title::before {
  content: '';
  position: absolute;
  inset: calc(50% - 22px) 0;
}

.best_paper .title {
  color: var(--blue-deep);
}

.black_hole .title {
  color: var(--red-deep);
}

.line {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.total {
  font-size: var(--text-lg);
  font-weight: var(--weight-display);
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
