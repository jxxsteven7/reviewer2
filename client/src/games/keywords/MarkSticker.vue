<script setup lang="ts">
import type { Mark, Team } from '@reviewer2/shared/keywords';

// The round sticker of a group's mark (docs/games/keywords.md#talking-it-over), in the color it
// stands for, with a sign of its own, so that color is never the only signal: a tick for one of
// the group's own cards, a cross for one of the other group's, an exclamation mark for maybe
// Reviewer 2. On a card's corner, and `small` on the buttons that set the marks. It is for the eye
// alone: the card's accessible name, and the button's words, say what it is.
withDefaults(defineProps<{ mark: Mark; color: Team | 'r2'; small?: boolean }>(), { small: false });
</script>

<template>
  <span class="mark-sticker" :class="[color, { small }]" aria-hidden="true">
    <svg viewBox="0 0 24 24" focusable="false">
      <path v-if="mark === 'ours'" d="M5.5 12.5 10 17l8.5-9.5" />
      <path v-else-if="mark === 'theirs'" d="M7 7l10 10M17 7 7 17" />
      <template v-else>
        <path d="M12 5.5v8" />
        <path class="dot" d="M12 18.5h.01" />
      </template>
    </svg>
  </span>
</template>

<style scoped>
.mark-sticker {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: var(--line-thin) solid var(--ink);
  border-radius: 50%;
}

.mark-sticker.small {
  width: 17px;
  height: 17px;
  border-width: 1.5px;
}

svg {
  width: 70%;
  height: 70%;
  fill: none;
  stroke: currentcolor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 3.2;
}

.dot {
  stroke-width: 4;
}

.red {
  background: var(--red);
  color: var(--on-red);
}

.blue {
  background: var(--blue);
  color: var(--on-blue);
}

.r2 {
  background: var(--r2);
  color: var(--on-r2);
}
</style>
