<script setup lang="ts">
import type { KeywordsView } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';

// Every clue so far, newest first, with the cards revealed after it, like a list of references. A
// turn whose time ran out says so: before the clue, it has none.
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
        <span class="turn num">[{{ record.turn }}]</span>
        <span v-if="record.word === null" class="clue missing">{{ t('game.noClueInTime') }}</span>
        <span v-else class="clue">
          <span class="word">{{ record.word }}</span>
          <span class="count num">{{ record.count === 'unlimited' ? INFINITY : record.count }}</span>
        </span>
        <span v-if="record.guesses.length" class="guesses">
          <span v-for="guess in record.guesses" :key="guess.card" class="guess" :class="guess.color">
            <span class="swatch" aria-hidden="true"></span>
            {{ word(guess.card) }}
            <span class="sr">{{ t(`game.card.${guess.color}`) }}</span>
          </span>
        </span>
        <span v-if="record.timedOut && record.word !== null" class="timed-out">{{ t('game.timeRanOut') }}</span>
      </li>
    </ol>
    <p v-else class="empty">{{ t('game.noClues') }}</p>
  </section>
</template>

<style scoped>
.clue-log {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
}

ol {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Each clue on a block in its group's tint. */
li {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-1) var(--space-2);
  align-items: center;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-card);
  background: var(--paper-2);
}

li.red {
  background: var(--red-tint);
}

li.blue {
  background: var(--blue-tint);
}

.turn {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.clue {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.word {
  font-size: var(--text-lg);
  font-weight: var(--weight-black);
}

.count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  border-radius: var(--radius-pill);
  background: var(--ink);
  color: var(--on-ink);
  font-weight: var(--weight-display);
}

.missing,
.timed-out {
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.timed-out {
  grid-column: 2;
}

.guesses {
  display: flex;
  flex-wrap: wrap;
  grid-column: 2;
  gap: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.guess {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.swatch {
  width: 12px;
  height: 12px;
  border: 2px solid var(--ink);
  border-radius: 3px;
}

/* The swatch takes the card's color, never the group's, which the li carries too. */
.guess.red .swatch {
  background: var(--red);
}

.guess.blue .swatch {
  background: var(--blue);
}

.guess.neutral .swatch {
  background: var(--neutral);
}

.guess.reviewer2 .swatch {
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
  color: var(--ink-2);
}
</style>
