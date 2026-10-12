<script setup lang="ts">
import { replaySteps, type CardView, type KeywordsReplay, type ReplayStep } from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from '../../core/components/UiButton.vue';
import { HTML_LANG } from '../../core/i18n';
import KeywordsBoard from './KeywordsBoard.vue';

// A finished game, step by step (shared/src/games/keywords/replay.ts): the board as it stood at
// each step, with every color, the card the step is about outlined, and above it the turn, the
// clue, who revealed what and whether it was right. The slider goes to any step, the buttons to
// the next and the last one. It takes a replay object and nothing else, so that the results page
// and the account page show one the same way.
const props = defineProps<{ replay: KeywordsReplay }>();
const { t } = useI18n();
const INFINITY = '\u221e';

const steps = computed(() => replaySteps(props.replay));
// The step shown, from the start. It stays where it is when the same game comes again, as it
// does with every snapshot while the results page is open; another game starts over.
const at = ref(0);
watch(
  () => props.replay.gameId,
  () => (at.value = 0),
);
const step = computed(() => steps.value[at.value] as ReplayStep);
const last = computed(() => at.value === steps.value.length - 1);

const cards = computed<CardView[]>(() =>
  props.replay.cards.map((card, index) => ({ ...card, revealed: step.value.revealed.includes(index) })),
);
const group = (team: 'red' | 'blue') => t(`lobby.group.${team}`);

// What the step says, line by line.
const lines = computed(() => {
  const { turn, team, clue, guess, timedOut } = step.value;
  if (turn === null || team === null) return [t('replay.start')];
  const found: string[] = [t('replay.turn', { turn, group: group(team) })];
  if (clue === null) found.push(t('replay.noClue'));
  else found.push(t('replay.clue', { word: clue.word, count: clue.count === 'unlimited' ? INFINITY : clue.count }));
  if (guess) {
    const name = props.replay.players[guess.player] ?? t('replay.someone');
    const word = props.replay.cards[guess.card]?.word ?? '';
    const outcome = guess.right
      ? t('replay.right')
      : t(`replay.wrong.${guess.color === 'neutral' || guess.color === 'reviewer2' ? guess.color : 'team'}`);
    found.push(t('replay.revealed', { name, word, outcome }));
  }
  if (timedOut && clue !== null) found.push(t('replay.timedOut'));
  if (last.value) {
    const { winner } = props.replay.result;
    found.push(winner === null ? t('replay.withdrawn') : t('replay.won', { group: group(winner) }));
  }
  return found;
});
</script>

<template>
  <div class="replay">
    <p class="position num">{{ t('replay.step', { step: at + 1, steps: steps.length }) }}</p>
    <div class="controls">
      <UiButton size="small" :disabled="at === 0" @click="at -= 1">{{ t('replay.previous') }}</UiButton>
      <input
        v-model.number="at"
        type="range"
        min="0"
        :max="steps.length - 1"
        step="1"
        :aria-label="t('replay.slider')"
      />
      <UiButton size="small" :disabled="last" @click="at += 1">{{ t('replay.next') }}</UiButton>
    </div>
    <div class="step" :class="step.team ?? 'start'" aria-live="polite">
      <p v-for="line in lines" :key="line">{{ line }}</p>
    </div>
    <KeywordsBoard
      :cards="cards"
      :selectable="false"
      :selected="null"
      :marked="step.guess?.card ?? null"
      :lang="HTML_LANG[replay.language]"
    />
  </div>
</template>

<style scoped>
.replay {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.position {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.controls {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

input[type='range'] {
  flex: 1;
  min-width: 0;
  accent-color: var(--ink);
}

/* The step's lines on a block in the group's tint, as a clue is in the log. */
.step {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-height: 4.5em;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-card);
  background: var(--paper-2);
  font-size: var(--text-sm);
}

.step p:first-child {
  font-weight: var(--weight-black);
}

.step.red {
  background: var(--red-tint);
}

.step.blue {
  background: var(--blue-tint);
}
</style>
