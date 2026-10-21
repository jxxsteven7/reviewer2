<script lang="ts">
import type { Team } from '@reviewer2/shared/keywords';

// A number to rise: its text, such as "+1", and the group whose color it takes; once shown, with a
// key that tells it from the one before, so that one right after another starts its own.
export interface Float {
  text: string;
  team: Team;
}
export type Shown = Float & { key: number };
</script>

<script setup lang="ts">
// A number that rises from where points were won or lost and fades as it goes, as in a game
// (docs/games/keywords.md#points-as-they-come): handwritten, in the color of the group it is for,
// with no ground under it but a ring of paper around each stroke, so that it reads on a card of its
// own color too. It starts a little below the middle of what it stands on, which its parent makes
// the containing block, and rises a short way: on a card (`card`), on an avatar (`avatar`), or, big,
// in the middle of the screen at the end of the game (`end`). With reduced motion it fades in and
// out where it is. It is for the eye alone, and lets every tap through.
withDefaults(defineProps<{ float: Float; size?: 'card' | 'avatar' | 'end' }>(), { size: 'card' });
</script>

<template>
  <span class="score-float" :class="[float.team, `on-${size}`]" aria-hidden="true">{{ float.text }}</span>
</template>

<style scoped>
/* The ring is drawn with shadows rather than a stroke: a stroke over the letters, where a browser
   doesn't paint it under them, would eat the thin strokes of the hand. Sixteen of them, a ring's
   width away in as many directions, make it round. */
.score-float {
  --ring: 3px;
  --ring-a: calc(var(--ring) * 0.924);
  --ring-b: calc(var(--ring) * 0.383);
  --ring-d: calc(var(--ring) * 0.707);
  --rise: -32px;

  position: absolute;
  top: 58%;
  left: 50%;
  z-index: 3;
  font-family: var(--font-hand);
  font-size: 34px;
  font-size: clamp(28px, 11cqi, 60px);
  font-weight: 400;
  line-height: 1;
  white-space: nowrap;
  pointer-events: none;
  text-shadow:
    var(--ring) 0 var(--paper),
    calc(-1 * var(--ring)) 0 var(--paper),
    0 var(--ring) var(--paper),
    0 calc(-1 * var(--ring)) var(--paper),
    var(--ring-d) var(--ring-d) var(--paper),
    calc(-1 * var(--ring-d)) var(--ring-d) var(--paper),
    var(--ring-d) calc(-1 * var(--ring-d)) var(--paper),
    calc(-1 * var(--ring-d)) calc(-1 * var(--ring-d)) var(--paper),
    var(--ring-a) var(--ring-b) var(--paper),
    calc(-1 * var(--ring-a)) var(--ring-b) var(--paper),
    var(--ring-a) calc(-1 * var(--ring-b)) var(--paper),
    calc(-1 * var(--ring-a)) calc(-1 * var(--ring-b)) var(--paper),
    var(--ring-b) var(--ring-a) var(--paper),
    calc(-1 * var(--ring-b)) var(--ring-a) var(--paper),
    var(--ring-b) calc(-1 * var(--ring-a)) var(--paper),
    calc(-1 * var(--ring-b)) calc(-1 * var(--ring-a)) var(--paper);
  opacity: 0;
  transform: translate(-50%, -50%);
  animation: rise 1.4s ease-out forwards;
}

.red {
  color: var(--red-deep);
}

.blue {
  color: var(--blue-deep);
}

/* On a phone the cards are small, and the number rises less. */
@media (max-width: 40rem) {
  .on-card {
    --rise: -22px;
  }
}

.on-avatar {
  top: 50%;
  font-size: 30px;
  --rise: -28px;
}

.on-end {
  --ring: 4px;
  --rise: -64px;

  position: fixed;
  top: 55%;
  z-index: 30;
  font-size: clamp(88px, 26vw, 168px);
  animation-duration: 2.5s;
}

@keyframes rise {
  0% {
    opacity: 0;
    transform: translate(-50%, -50%) translateY(6px);
  }

  12% {
    opacity: 1;
    transform: translate(-50%, -50%);
  }

  60% {
    opacity: 1;
  }

  100% {
    opacity: 0;
    transform: translate(-50%, -50%) translateY(var(--rise));
  }
}

@keyframes fade {
  0% {
    opacity: 0;
  }

  15%,
  70% {
    opacity: 1;
  }

  100% {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .score-float {
    animation-name: fade;
  }
}
</style>
