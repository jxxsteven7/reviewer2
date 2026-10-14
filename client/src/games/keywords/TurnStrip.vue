<script setup lang="ts">
import { TEAMS, type GuessRule, type KeywordsView, type PlayerView, type Team } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import PlayerAvatar from '../../core/components/PlayerAvatar.vue';
import ClockBar from './ClockBar.vue';

// Whose turn it is, in which phase, with the current clue, how much time the phase has left and
// how many cards each group still has to find, on one sticker above the board. The phase is set
// in the display fonts, in the current group's color. Under the free guess rule, a clue's number
// sets no limit, so there is none to show. The game page shows the clock apart, under the strip,
// where it can stay at the top of the screen (KeywordsGame).
//
// Each group's bar shows who is in it rather than its name, which only a screen reader is told:
// the PI's avatar first, with a small tag on its lower edge, then a thin line, then the students,
// overlapping, each in front of the next, the viewer first among them and ringed in white, the
// others in the order of their seats. A phone has room for two students and a wider screen for six;
// "+n" counts the rest. Someone offline has the avatar of someone the room waits for (PlayerAvatar).
interface Group {
  team: Team;
  captain: PlayerView | null;
  guessers: PlayerView[];
}
const props = withDefaults(
  defineProps<{
    game: KeywordsView;
    guessRule: GuessRule;
    clockApart?: boolean;
    groups?: Group[];
    me?: string | null;
  }>(),
  { clockApart: false, groups: () => [], me: null },
);
const { t } = useI18n();

// The most students a bar shows on a phone, and on a wider screen.
const FEW = 2;
const MANY = 6;

const groupOf = (team: Team) => props.groups.find((group) => group.team === team);
const piOf = (team: Team) => groupOf(team)?.captain ?? null;
const studentsOf = (team: Team) => {
  const guessers = groupOf(team)?.guessers ?? [];
  return [...guessers.filter(({ id }) => id === props.me), ...guessers.filter(({ id }) => id !== props.me)];
};

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
    <ClockBar v-if="game.clock && !clockApart" :clock="game.clock" :frozen="game.paused" />
    <p class="scores">
      <span v-for="team in TEAMS" :key="team" class="score num" :class="team">
        <span class="faces">
          <span class="sr-only">{{ t(`lobby.group.${team}`) }}</span>
          <span v-if="piOf(team)" class="pi" aria-hidden="true">
            <PlayerAvatar
              :name="piOf(team)!.name"
              :avatar="piOf(team)!.avatar"
              :agent="piOf(team)!.agent !== undefined"
              :waiting="!piOf(team)!.online"
              :class="{ me: piOf(team)!.id === me }"
            />
            <span class="pi-tag">{{ t('game.piTag') }}</span>
          </span>
          <span v-if="piOf(team) && studentsOf(team).length" class="divider" aria-hidden="true"></span>
          <span class="students" aria-hidden="true">
            <span
              v-for="(student, index) in studentsOf(team).slice(0, MANY)"
              :key="student.id"
              class="face"
              :class="{ extra: index >= FEW }"
              :style="{ zIndex: MANY - index }"
            >
              <PlayerAvatar
                :name="student.name"
                :avatar="student.avatar"
                :agent="student.agent !== undefined"
                :waiting="!student.online"
                :class="{ me: student.id === me }"
              />
            </span>
            <span v-if="studentsOf(team).length > FEW" class="more few">+{{ studentsOf(team).length - FEW }}</span>
            <span v-if="studentsOf(team).length > MANY" class="more many">+{{ studentsOf(team).length - MANY }}</span>
          </span>
        </span>
        <span>{{ t('game.remaining', { count: game.remaining[team] }) }}</span>
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
  flex: 1 1 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
  min-height: 46px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-card);
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
}

/* Who is in the group, in the bar's middle from top to bottom: the PI's tag hangs over the lower
   edge of the avatar, inside the bar. */
.faces {
  --face: 28px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.faces :deep(.avatar) {
  width: var(--face);
  height: var(--face);
  font-size: 0.85rem;
}

.faces :deep(.avatar.me) {
  box-shadow: 0 0 0 2px var(--paper);
}

.pi {
  position: relative;
  display: inline-flex;
  flex: none;
}

.pi-tag {
  position: absolute;
  bottom: -6px;
  left: 50%;
  z-index: 2;
  padding: 0 4px;
  border: 1.5px solid var(--paper);
  border-radius: var(--radius-pill);
  background: var(--ink);
  color: var(--on-ink);
  font-family: var(--font-sans);
  font-size: 9px;
  font-weight: var(--weight-black);
  line-height: 12px;
  white-space: nowrap;
  transform: translateX(-50%);
}

.divider {
  flex: none;
  width: 2px;
  height: 22px;
  border-radius: 1px;
  background: currentcolor;
  opacity: 0.4;
}

.students {
  display: inline-flex;
  align-items: center;
  min-width: 0;
}

.face {
  position: relative;
  display: inline-flex;
  flex: none;
}

.face + .face {
  margin-left: -5px;
}

.face.extra,
.more.many {
  display: none;
}

.more {
  margin-left: 4px;
  font-size: var(--text-xs);
}

/* On a wide screen, a little more room: six students, and the bars a little taller. */
@media (min-width: 64rem) {
  .score {
    min-height: 48px;
    padding: 0 var(--space-4);
  }

  .faces {
    --face: 30px;
  }

  .face + .face {
    margin-left: -4px;
  }

  .pi-tag {
    bottom: -5px;
    font-size: 10px;
  }

  .face.extra {
    display: inline-flex;
  }

  .more.few {
    display: none;
  }

  .more.many {
    display: inline;
  }
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
