<script setup lang="ts">
import { TEAMS, type Team } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import AvatarButton from '../../core/components/AvatarButton.vue';

// The two groups' bars, as the strip above the board shows them (TurnStrip.vue) and a replay does
// (ReplayViewer.vue): who is in each group rather than its name, which only a screen reader is
// told, and how many cards it has still to find. The PI's avatar comes first, with a small tag on
// its lower edge, then a thin line, then the students, overlapping, each in front of the next, the
// viewer first among them, the others in the order of their seats. A phone has room for two
// students and a wider screen for six; "+n" counts the rest, and opens nothing. Someone offline has
// the avatar of someone the room waits for (PlayerAvatar). Each avatar opens the player's panel
// where the page opens one (AvatarButton.vue): the room's panel in a game, the replay's in a
// replay; a big screen opens none. Where students overlap, each one's tap area is the part of them
// that shows, so that a tap never opens the one in front for the one behind.
export interface Member {
  id: string;
  name: string;
  // An account's username, which its default avatar is drawn from (AvatarButton.vue).
  username?: string;
  initial?: string | null;
  avatar?: string | null;
  guest?: number;
  agent?: string;
  online?: boolean;
}
export interface Group {
  team: Team;
  captain: Member | null;
  guessers: Member[];
}
const props = withDefaults(defineProps<{ groups: Group[]; remaining: Record<Team, number>; me?: string | null }>(), {
  me: null,
});
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
</script>

<template>
  <p class="scores">
    <span v-for="team in TEAMS" :key="team" class="score num" :class="team">
      <span class="faces">
        <span class="sr-only">{{ t(`lobby.group.${team}`) }}</span>
        <span v-if="piOf(team)" class="pi">
          <AvatarButton
            :player-id="piOf(team)!.id"
            :name="piOf(team)!.name"
            :username="piOf(team)!.username"
            :initial="piOf(team)!.initial"
            :avatar="piOf(team)!.avatar"
            :guest="piOf(team)!.guest"
            :agent="piOf(team)!.agent !== undefined"
            :waiting="piOf(team)!.online === false"
          />
          <span class="pi-tag" aria-hidden="true">{{ t('game.piTag') }}</span>
        </span>
        <span v-if="piOf(team) && studentsOf(team).length" class="divider" aria-hidden="true"></span>
        <span class="students">
          <span
            v-for="(student, index) in studentsOf(team).slice(0, MANY)"
            :key="student.id"
            class="face"
            :class="{ extra: index >= FEW }"
            :style="{ zIndex: MANY - index }"
          >
            <AvatarButton
              :player-id="student.id"
              :name="student.name"
              :username="student.username"
              :initial="student.initial"
              :avatar="student.avatar"
              :guest="student.guest"
              :agent="student.agent !== undefined"
              :waiting="student.online === false"
            />
          </span>
          <span v-if="studentsOf(team).length > FEW" class="more few" aria-hidden="true"
            >+{{ studentsOf(team).length - FEW }}</span
          >
          <span v-if="studentsOf(team).length > MANY" class="more many" aria-hidden="true"
            >+{{ studentsOf(team).length - MANY }}</span
          >
        </span>
      </span>
      <span>{{ t('game.remaining', { count: remaining[team] }) }}</span>
    </span>
  </p>
</template>

<style scoped>
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

/* Overlapping students: each one's tap area is 44px high and as wide as the avatar, and the one in
   front covers the next, so that each is tapped where it shows. */
.face :deep(.avatar-button::before) {
  inset: calc(50% - 22px) 0;
}

/* The focus ring is ink here: the page's blue would be lost on the blue bar, and faint on the red. */
.faces :deep(.avatar-button:focus-visible) {
  outline-color: var(--ink);
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
