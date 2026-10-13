<script setup lang="ts">
import { otherTeam, type ClueRecord, type GameEvent, type KeywordsView } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatList } from '../../core/i18n';

// Every clue so far, newest first, with the cards revealed after it, like a list of references. A
// turn whose time ran out says so: before the clue, it has none, which is all the log says of a
// missed deadline. A pause, its end and an extension are noted in short under the turn they came
// in, which may have no clue yet. During a pause there is no board, so a revealed card shows its
// color alone. Once the game is over, a clue whose PI marked the cards it was meant for names
// them, and how many of them the group found.
const props = defineProps<{ game: KeywordsView }>();
const { t, locale } = useI18n();
const INFINITY = '\u221e';

const word = (index: number) => props.game.cards[index]?.word ?? '';

// The turns that have a clue or an event, the latest first, each with what it has.
const turns = computed(() => {
  const found = new Map<number, { record: ClueRecord | null; events: GameEvent[] }>();
  const of = (turn: number) => {
    let entry = found.get(turn);
    if (!entry) found.set(turn, (entry = { record: null, events: [] }));
    return entry;
  };
  for (const record of props.game.history) of(record.turn).record = record;
  for (const event of props.game.events) if (event.kind !== 'missed') of(event.turn).events.push(event);
  return [...found]
    .sort(([a], [b]) => b - a)
    .map(([turn, entry]) => ({ turn, ...entry, team: entry.record?.team ?? teamOf(turn) }));
});

// Whose turn a turn without a clue yet is: the starting group plays the odd ones.
const teamOf = (turn: number) => (turn % 2 === 1 ? props.game.startingTeam : otherTeam(props.game.startingTeam));

// The cards a PI meant with a clue, and how many of them the group revealed in that turn.
const meant = (record: ClueRecord) => {
  const targets = record.targets ?? [];
  const found = targets.filter((card) => record.guesses.some((guess) => guess.card === card)).length;
  return [
    t('game.meant', { words: formatList(locale.value, targets.map(word)) }),
    t('game.meantFound', { found, total: targets.length }),
  ].join(' \u00b7 ');
};

const eventText = (event: GameEvent) =>
  t(`game.events.${event.kind}`, { group: event.team ? t(`lobby.group.${event.team}`) : '' });
</script>

<template>
  <section class="clue-log">
    <h2 class="section-title">{{ t('game.log') }}</h2>
    <ol v-if="turns.length" reversed>
      <li v-for="{ turn, record, events, team } in turns" :key="turn" :class="team">
        <span class="turn num">[{{ turn }}]</span>
        <template v-if="record">
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
          <span v-if="record.targets?.length" class="meant">{{ meant(record) }}</span>
          <span v-if="record.timedOut && record.word !== null" class="timed-out">{{ t('game.timeRanOut') }}</span>
        </template>
        <span v-else class="clue missing">{{ t('game.noClues') }}</span>
        <span v-for="(event, index) in events" :key="index" class="event">{{ eventText(event) }}</span>
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

.timed-out,
.event,
.meant {
  grid-column: 2;
}

.meant {
  font-size: var(--text-sm);
}

.event {
  color: var(--ink-2);
  font-size: var(--text-xs);
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
  border: var(--line-thin) solid var(--ink);
  border-radius: var(--radius-small);
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
