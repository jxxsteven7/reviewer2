<script setup lang="ts">
import type { ImpostorReplay, SeatView } from '@reviewer2/shared/impostor';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ReplaySteps from '../../core/components/ReplaySteps.vue';
import ReplayTalk from '../../core/components/ReplayTalk.vue';
import { nameOf } from '../../core/names';
import RevealList from './RevealList.vue';
import RoundBody from './RoundBody.vue';
import { outIn, roundsOf } from './seats';

// A finished game of the hidden word game, round by round (docs/architecture.md#replays): a step
// for each round, with how it came out and, under it, every line, vote and report of the round as
// the record shows them (RoundBody.vue), and a last step with the result and who everyone was
// (RevealList.vue), every number named as the page names people (names.ts). The account's own
// number is yellow. The results page may add what was said after the game (`talk`), last.
const props = withDefaults(
  defineProps<{ replay: ImpostorReplay; talk?: readonly { id: number | string; name: string; text: string }[] }>(),
  { talk: () => [] },
);
const { t } = useI18n();

const lastRound = computed(() =>
  Math.max(1, ...[...props.replay.lines, ...props.replay.ballots, ...props.replay.reports].map((item) => item.round)),
);
const rounds = computed(() => roundsOf({ ...props.replay, round: lastRound.value }));
const steps = computed(() => rounds.value.length + 1);
const at = ref(0);
watch(
  () => props.replay.gameId,
  () => (at.value = 0),
);
const record = computed(() => rounds.value[at.value] ?? null);
const mine = computed(() => props.replay.players.find((seat) => seat.playerId === props.replay.me)?.number ?? null);
const roleOf = (number: number) => props.replay.players.find((seat) => seat.number === number)?.role;

const lines = computed(() => {
  const shown = record.value;
  if (!shown) {
    const { result, words } = props.replay;
    return [
      t(`games.impostor.letter.results.${result.reason}`),
      t('games.impostor.reveal.words', { student: words.student, reviewer2: words.reviewer2 }),
    ];
  }
  const out = outIn(shown);
  const role = out === null ? undefined : roleOf(out);
  return [
    t('games.impostor.record.round', { round: shown.round }),
    out === null
      ? t('games.impostor.record.nobodyOut')
      : t('games.impostor.record.outAside', { number: out, role: role ? t(`games.impostor.roles.${role}`) : '' }),
  ];
});

// The end as the game's page shows it, with every role known.
const reveal = computed(() => ({
  seats: props.replay.players,
  points: props.replay.points,
  you: mine.value === null ? null : { number: mine.value, role: roleOf(mine.value) ?? null, word: null },
  words: props.replay.words,
  revealed: true,
}));
const named = (seat: SeatView) => {
  const person = seat.playerId === null ? undefined : props.replay.people[seat.playerId];
  return person ? nameOf(person) : t('replay.someone');
};
</script>

<template>
  <div class="replay">
    <ReplaySteps v-model="at" :steps="steps" :lines="lines" />
    <RoundBody v-if="record" :record="record" :mine="mine" />
    <RevealList v-else :game="reveal" :name-of="named" />
    <ReplayTalk v-if="talk.length" :talk="talk" />
  </div>
</template>

<style scoped>
.replay {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
</style>
