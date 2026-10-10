<script setup lang="ts">
import type { GuessRule, KeywordsView } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ClockBar from './ClockBar.vue';

// Whose turn it is, in which phase, with the current clue, how much time the phase has left and
// how many cards each group still has to find, on one sticker above the board. The phase is set
// in the display fonts, in the current group's color. Under the free guess rule, a clue's number
// sets no limit, so there is none to show.
const props = defineProps<{ game: KeywordsView; guessRule: GuessRule }>();
const { t } = useI18n();

const group = computed(() => t(`lobby.group.${props.game.team}`));
const phase = computed(() => t(`game.phase.${props.game.phase}`, { group: group.value }));
const count = computed(() => {
  const value = props.game.clue?.count;
  return value === 'unlimited' ? '\u221e' : String(value ?? '');
});
</script>

<template>
  <section class="strip" :class="game.phase === 'over' ? 'over' : game.team" aria-live="polite">
    <p class="line">
      <span class="phase display">{{ phase }}</span>
      <span class="turn num">{{ t('game.turn', { turn: game.turn }) }}</span>
    </p>
    <p v-if="game.clue" class="clue">
      <span class="label">{{ t('game.clue') }}</span>
      <span class="word">{{ game.clue.word }}</span>
      <span class="count num">{{ count }}</span>
      <span v-if="guessRule === 'standard'" class="left num">
        {{ game.guessesLeft === null ? t('game.noLimit') : t('game.guessesLeft', { count: game.guessesLeft }) }}
      </span>
    </p>
    <ClockBar v-if="game.clock" :clock="game.clock" />
    <p class="scores">
      <span class="score red num">
        <span class="name">{{ t('lobby.group.red') }}</span>
        <span>{{ t('game.remaining', { count: game.remaining.red }) }}</span>
      </span>
      <span class="score blue num">
        <span class="name">{{ t('lobby.group.blue') }}</span>
        <span>{{ t('game.remaining', { count: game.remaining.blue }) }}</span>
      </span>
    </p>
  </section>
</template>

<style scoped>
.strip {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: var(--space-3) 0 0;
  padding: var(--space-3) var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
}

.line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-1) var(--space-3);
}

.phase {
  font-size: var(--text-2xl);
}

.strip.red .phase {
  color: var(--red-deep);
}

.strip.blue .phase {
  color: var(--blue-deep);
}

.turn {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.clue {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.clue .label {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

/* The clue on its own yellow sticker, with its number on an ink disc beside it. */
.clue .word {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--bg);
  font-size: var(--text-xl);
  font-weight: var(--weight-black);
}

.clue .count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--ink);
  color: var(--on-ink);
  font-size: var(--text-xl);
  font-weight: var(--weight-display);
}

.clue .left {
  margin-left: auto;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.scores {
  display: flex;
  gap: var(--space-2);
}

.score {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-height: 40px;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-card);
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
}

.score.red {
  background: var(--red);
  color: var(--on-red);
}

.score.blue {
  background: var(--blue);
  color: var(--on-blue);
}
</style>
