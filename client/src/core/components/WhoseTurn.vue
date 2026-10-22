<script setup lang="ts">
import { computed } from 'vue';
import type { Tint } from '../tints';

// The whose-turn strip above a game's board, in every game (docs/rules/display.md#a-games-room): a
// white sticker on which a short line says who the viewer is, in letter-spaced capitals, in the
// deep shade of their side's tint or in grey, and a sentence in the display fonts says what happens
// now (`line`), in the deep shade of the side whose turn it is, if the game has sides, with the
// turn or the round on its right. While it is the viewer's side's turn (`ours`), the strip takes
// that side's tint, so that a player sees at a glance that the game waits for their side. A
// sentence that waits for someone ends in an ellipsis, which breathes a little, by CSS alone: the
// words stay as they are. What the game adds to it, such as the clue or the viewer's word, goes in
// the slot, and the clock and the groups' bars after it (`after`). A short grey line under the
// sentence may say why a wait is long (`note`), as while Reviewer 1 thinks. The lines are read out
// as they change.
const props = withDefaults(
  defineProps<{
    line: string;
    note?: string | null;
    turn?: string | null;
    who?: string | null;
    whoTint?: Tint | null;
    tint?: Tint | null;
    ours?: boolean;
  }>(),
  { note: null, turn: null, who: null, whoTint: null, tint: null, ours: false },
);

// The line's words, and the ellipsis it ends in while someone is waited for, if any.
const parts = computed(() => {
  const found = /^(.*?)(…+)$/su.exec(props.line);
  return found ? { text: found[1] ?? '', dots: found[2] ?? '' } : { text: props.line, dots: '' };
});
</script>

<template>
  <section class="strip" :class="[tint, { ours }]">
    <div class="lines" aria-live="polite">
      <p v-if="who" class="who" :class="whoTint ?? 'plain'">{{ who }}</p>
      <p class="line">
        <span class="phase display"
          >{{ parts.text }}<span v-if="parts.dots" class="dots">{{ parts.dots }}</span></span
        >
        <span v-if="turn" class="turn num">{{ turn }}</span>
      </p>
      <p v-if="note" class="note">{{ note }}</p>
      <slot />
    </div>
    <slot name="after" />
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

.strip.ours.red {
  background: var(--red-tint);
}

.strip.ours.blue {
  background: var(--blue-tint);
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

/* Who the viewer is, over the line, close to it, in the color of their side, or grey. */
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

.who.plain {
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

/* Why the wait is long, close under the line. */
.note {
  margin-top: calc(-1 * var(--space-2));
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}
</style>
