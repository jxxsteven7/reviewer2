<script setup lang="ts">
import { replaySteps, type CardView, type KeywordsReplay, type ReplayStep } from '@reviewer2/shared';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from '../../core/components/UiButton.vue';
import { formatList, HTML_LANG } from '../../core/i18n';
import KeywordsBoard from './KeywordsBoard.vue';

// A finished game, step by step (shared/src/games/keywords/replay.ts): the board as it stood at
// each step, with every color, the card the step is about outlined, and above it the turn, the
// clue, who revealed what and whether it was right. The cards the PI meant with the turn's clue, if
// they marked any, carry their numbers through the turn, and the clue's step names them. The
// slider goes to any step, the buttons to the next and the last one. It takes a replay object and
// nothing else, so that the results page and the account page show one the same way; the results
// page adds what the viewer's group has said since the game ended (`talk`), which comes last, under
// the board, as the group talks the game over.
const props = withDefaults(
  defineProps<{ replay: KeywordsReplay; talk?: readonly { id: number; name: string; text: string }[] }>(),
  { talk: () => [] },
);
const { t, locale } = useI18n();
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
// The cards the PI meant with the clue of the step's turn, in the order marked.
const targets = computed(() => props.replay.history.find((record) => record.turn === step.value.turn)?.targets ?? []);

// Who revealed a card: an AI player by its persona's name (docs/architecture.md#ai-players), anyone
// else by the name they had in the game.
function nameOf(playerId: string): string {
  const persona = props.replay.agents?.[playerId];
  if (persona) return t(`agents.personas.${persona}`);
  return props.replay.players[playerId] ?? t('replay.someone');
}

// What the step says, line by line.
const lines = computed(() => {
  const { turn, team, clue, guess, timedOut } = step.value;
  if (turn === null || team === null) return [t('replay.start')];
  const found: string[] = [t('replay.turn', { turn, group: group(team) })];
  if (clue === null) found.push(t('replay.noClue'));
  else found.push(t('replay.clue', { word: clue.word, count: clue.count === 'unlimited' ? INFINITY : clue.count }));
  if (clue !== null && guess === null && !timedOut && targets.value.length > 0) {
    const words = targets.value.map((card) => props.replay.cards[card]?.word ?? '');
    found.push(t('game.meant', { words: formatList(locale.value, words) }));
  }
  if (guess) {
    const name = nameOf(guess.player);
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
      :targets="targets"
      :lang="HTML_LANG[replay.language]"
    />
    <section v-if="talk.length > 0" class="talk">
      <h3 class="section-title">{{ t('replay.talk') }}</h3>
      <p v-for="line in talk" :key="line.id" class="line">
        <span class="name">{{ line.name }}</span>
        <span>{{ line.text }}</span>
      </p>
    </section>
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

/* What the group said after the game, as the chat shows it. */
.talk {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.talk .line {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-card);
  background: var(--paper-2);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.talk .name {
  margin-right: var(--space-2);
  font-weight: var(--weight-black);
}
</style>
