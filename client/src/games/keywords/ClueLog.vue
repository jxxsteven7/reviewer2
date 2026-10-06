<script setup lang="ts">
import type { KeywordsView } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';

// Every clue so far, newest first, with the cards revealed after it, like a list of references.
const props = defineProps<{ game: KeywordsView }>();
const { t } = useI18n();
const INFINITY = '\u221e';

const word = (index: number) => props.game.cards[index]?.word ?? '';
</script>

<template>
  <section class="clue-log">
    <h2 class="section-title">{{ t('game.log') }}</h2>
    <ol v-if="game.history.length" reversed>
      <li v-for="record in [...game.history].reverse()" :key="record.turn" :class="record.team">
        <span class="turn mono">[{{ record.turn }}]</span>
        <span class="clue">
          <span class="word">{{ record.word }}</span>
          <span class="count mono">{{ record.count === 'unlimited' ? INFINITY : record.count }}</span>
        </span>
        <span v-if="record.guesses.length" class="guesses">
          <span v-for="guess in record.guesses" :key="guess.card" class="guess" :class="guess.color">
            <span class="swatch" aria-hidden="true"></span>
            {{ word(guess.card) }}
            <span class="sr">{{ t(`game.card.${guess.color}`) }}</span>
          </span>
        </span>
      </li>
    </ol>
    <p v-else class="empty">{{ t('game.noClues') }}</p>
  </section>
</template>

<style scoped>
.clue-log {
  padding: var(--space-4) 0;
  border-top: 1px solid var(--rule);
}

ol {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
}

li {
  display: grid;
  grid-template-columns: 2.5rem 1fr;
  gap: var(--space-1) var(--space-2);
  padding-left: var(--space-2);
  border-left: 3px solid var(--rule);
}

li.red {
  border-left-color: var(--red);
}

li.blue {
  border-left-color: var(--blue);
}

.turn {
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.clue {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.word {
  font-family: var(--font-serif);
  font-weight: 600;
}

.count {
  color: var(--ink-2);
}

.guesses {
  display: flex;
  flex-wrap: wrap;
  grid-column: 2;
  gap: var(--space-1) var(--space-3);
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.guess {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.swatch {
  width: 10px;
  height: 10px;
  border: 1px solid var(--ink-3);
}

.red .swatch {
  border-color: var(--red);
  background: var(--red);
}

.blue .swatch {
  border-color: var(--blue);
  background: var(--blue);
}

.neutral .swatch {
  border-color: var(--neutral);
  background: var(--neutral);
}

.reviewer2 .swatch {
  border-color: var(--r2);
  background: var(--r2);
}

.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.empty {
  margin-top: var(--space-2);
  color: var(--ink-3);
}
</style>
