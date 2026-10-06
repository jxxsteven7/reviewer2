<script setup lang="ts">
import type { KeywordsView } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

// Whose turn it is, in which phase, with the current clue and how many cards each group still
// has to find. A bar in the current group's color runs down its left edge.
const props = defineProps<{ game: KeywordsView }>();
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
      <span class="turn">{{ t('game.turn', { turn: game.turn }) }}</span>
      <span class="phase">{{ phase }}</span>
    </p>
    <p v-if="game.clue" class="clue">
      <span class="label">{{ t('game.clue') }}</span>
      <span class="word">{{ game.clue.word }}</span>
      <span class="count mono">{{ count }}</span>
      <span class="left">
        {{ game.guessesLeft === null ? t('game.noLimit') : t('game.guessesLeft', { count: game.guessesLeft }) }}
      </span>
    </p>
    <p class="scores">
      <span class="score red">
        <span class="name">{{ t('lobby.group.red') }}</span>
        <span>{{ t('game.remaining', { count: game.remaining.red }) }}</span>
      </span>
      <span class="score blue">
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
  gap: var(--space-1);
  margin: var(--space-4) 0 var(--space-3);
  padding: var(--space-1) 0 var(--space-1) var(--space-3);
  border-left: 4px solid var(--rule);
}

.strip.red {
  border-left-color: var(--red);
}

.strip.blue {
  border-left-color: var(--blue);
}

.line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
}

.turn {
  color: var(--ink-3);
  font-size: var(--text-sm);
  font-variant-caps: all-small-caps;
  letter-spacing: 0.06em;
}

.phase {
  font-weight: 600;
}

.clue {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
}

.clue .label {
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.clue .word {
  font-family: var(--font-serif);
  font-size: var(--text-xl);
  font-weight: 600;
}

.clue .count {
  font-size: var(--text-lg);
}

.clue .left {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.scores {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  font-size: var(--text-sm);
}

.score {
  display: inline-flex;
  gap: var(--space-1);
  color: var(--ink-2);
}

.score .name {
  font-weight: 600;
}

.score.red .name {
  color: var(--red);
}

.score.blue .name {
  color: var(--blue);
}
</style>
