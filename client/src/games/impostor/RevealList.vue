<script setup lang="ts">
import type { ImpostorView, SeatView } from '@reviewer2/shared/impostor';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AgentIcon from '../../core/components/AgentIcon.vue';
import { signedPoints } from '../../core/points';
import SeatAvatar from './SeatAvatar.vue';

// Who everyone was, once the hidden word game is over (docs/games/impostor.md#the-end): both words,
// and a beige row for each number, the viewer's own yellow, with its avatar, which opens the seat's
// panel, whoever sat there, as the page names them (`nameOf`), with the AI's mark, their role, how
// their game went, and the points it brought them, where it brought any. A player who still has to
// guess which numbers the AI players were sees the roles alone, until they have guessed. The game's
// page and its replay show it alike.
const props = defineProps<{
  game: Pick<ImpostorView, 'seats' | 'points' | 'you' | 'words' | 'revealed'>;
  nameOf: (seat: SeatView) => string | null;
  open?: ((number: number) => void) | null;
}>();
const { t } = useI18n();

const points = computed(() => new Map((props.game.points ?? []).map((entry) => [entry.number, entry.points])));
const rows = computed(() =>
  [...props.game.seats]
    .sort((a, b) => a.number - b.number)
    .map((seat) => {
      const own = seat.number === props.game.you?.number;
      return {
        seat,
        own,
        name: own ? t('games.impostor.reveal.you') : props.nameOf(seat),
        fate:
          seat.fate === 'alive'
            ? t('games.impostor.reveal.lasted')
            : seat.fate === 'voted_out'
              ? t('games.impostor.seat.votedOutIn', { round: seat.out ?? 0 })
              : t(`games.impostor.seat.${seat.fate}`),
        points: points.value.has(seat.number) ? signedPoints(points.value.get(seat.number) ?? 0) : null,
        bad: (points.value.get(seat.number) ?? 0) < 0,
      };
    }),
);
</script>

<template>
  <section class="reveal panel">
    <h2 class="section-title">
      {{ t('games.impostor.reveal.title') }}
      <span v-if="game.words" class="words">{{
        t('games.impostor.reveal.words', { student: game.words.student, reviewer2: game.words.reviewer2 })
      }}</span>
    </h2>
    <ul>
      <li v-for="row in rows" :key="row.seat.number" :class="{ own: row.own }">
        <SeatAvatar :number="row.seat.number" :opens="open ? () => open?.(row.seat.number) : null" />
        <span class="who">
          <span v-if="row.name" class="name">{{ row.name }}</span>
          <span v-if="row.seat.agent" class="tag-pill outlined"><AgentIcon />{{ t('room.agent') }}</span>
          <span v-if="row.seat.role" class="role">{{ t(`games.impostor.roles.${row.seat.role}`) }}</span>
        </span>
        <span class="fate">{{ row.fate }}</span>
        <span v-if="row.points !== null" class="points num" :class="{ bad: row.bad }">{{ row.points }}</span>
      </li>
    </ul>
    <p v-if="!game.revealed" class="hint">{{ t('games.impostor.reveal.afterGuess') }}</p>
  </section>
</template>

<style scoped>
.reveal {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.words {
  margin-inline-start: var(--space-2);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

ul {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-2);
  min-height: 44px;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-card);
  background: var(--paper-2);
}

li.own {
  background: var(--bg);
}

.who {
  display: inline-flex;
  flex: 1 1 8rem;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-2);
  min-width: 0;
  overflow-wrap: anywhere;
}

.name {
  font-weight: var(--weight-black);
}

.role,
.fate {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.fate {
  color: var(--ink-2);
}

/* Points won in blue and lost in red, in bold, as a ranking shows them. */
.points {
  min-width: 2.5em;
  color: var(--blue-deep);
  font-weight: var(--weight-black);
  text-align: end;
}

.points.bad {
  color: var(--red-deep);
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}
</style>
