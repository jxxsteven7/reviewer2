<script setup lang="ts">
import type { GuessRule, KeywordsView, Seat } from '@reviewer2/shared';
import { computed, onBeforeUnmount, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { bannerFor } from './banner';
import ClockBar from './ClockBar.vue';
import GroupBars, { type Group } from './GroupBars.vue';

// Whose turn it is, in which phase, with the current clue, how much time the phase has left and
// how many cards each group still has to find, on one sticker above the board. Under the free guess
// rule, a clue's number sets no limit, so there is none to show. The game page shows the clock
// apart, under the strip, where it can stay at the top of the screen (KeywordsGame).
//
// For a member of the room, the `seat` they are in: the strip says first, in small type in the
// color of their group, who they are, and then, in the display fonts, in the current group's
// color, what is going on for them now (banner.ts), such as "Your turn to guess!"; on their move
// the tab's title says so too, for a player who has gone to another tab while they wait. A line
// that waits for someone ends in an ellipsis, which breathes a little, by CSS alone: the words stay
// as they are. A big screen, which nobody sits at, says what the current group is doing.
//
// Under it, the two groups' bars (GroupBars.vue).
const props = withDefaults(
  defineProps<{
    game: KeywordsView;
    guessRule: GuessRule;
    seat?: Seat | null;
    clockApart?: boolean;
    groups?: Group[];
    me?: string | null;
  }>(),
  { seat: null, clockApart: false, groups: () => [], me: null },
);
const { t } = useI18n();

const group = computed(() => t(`lobby.group.${props.game.team}`));
const banner = computed(() => (props.seat ? bannerFor(props.seat, props.game) : null));
const who = computed(() => {
  if (!props.seat) return null;
  const { team, role } = props.seat;
  if (team === null) return t('banner.spectator');
  return t('banner.seat', { group: t(`lobby.group.${team}`), role: t(`banner.roles.${role}`) });
});
const line = computed(() => {
  if (!banner.value) return t(`game.phase.${props.game.phase}`, { group: group.value });
  const about = banner.value.group;
  return t(`banner.lines.${banner.value.line}`, { group: about ? t(`lobby.group.${about}`) : '' });
});
// The line's words, and the ellipsis it ends in while someone is waited for, if any.
const parts = computed(() => {
  const found = /^(.*?)(\u2026+)$/su.exec(line.value);
  return found ? { text: found[1] ?? '', dots: found[2] ?? '' } : { text: line.value, dots: '' };
});
const count = computed(() => {
  const value = props.game.clue?.count;
  return value === 'unlimited' ? '\u221e' : String(value ?? '');
});

const title = document.title;
watchEffect(() => {
  document.title = banner.value?.urgent ? t('banner.tabTitle') : title;
});
onBeforeUnmount(() => {
  document.title = title;
});
</script>

<template>
  <section class="strip" :class="[game.phase === 'over' ? 'over' : game.team, { urgent: banner?.urgent }]">
    <!-- The lines are read out as they change; the bars, whose avatars are buttons, aren't. -->
    <div class="lines" aria-live="polite">
      <p v-if="who" class="who" :class="seat?.team ?? 'spectator'">{{ who }}</p>
      <p class="line">
        <span class="phase display"
          >{{ parts.text }}<span v-if="parts.dots" class="dots">{{ parts.dots }}</span></span
        >
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
    </div>
    <ClockBar v-if="game.clock && !clockApart" :clock="game.clock" :frozen="game.paused" />
    <GroupBars :groups="groups" :remaining="game.remaining" :me="me" />
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

.lines {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-1) var(--space-3);
}

/* Who the viewer is, over the line, close to it, in the color of their group. */
.who {
  margin-bottom: calc(-1 * var(--space-2));
  font-size: var(--text-xs);
  font-weight: var(--weight-black);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.who.red {
  color: var(--red-deep);
}

.who.blue {
  color: var(--blue-deep);
}

.who.spectator {
  color: var(--ink-2);
}

.phase {
  font-size: var(--text-2xl);
}

/* The ellipsis of a line that waits breathes, gently. It stays an inline, so that a narrow screen
   never wraps it onto a line of its own. */
.dots {
  animation: breathe 2s ease-in-out infinite;
}

@keyframes breathe {
  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dots {
    animation: none;
  }
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
</style>
