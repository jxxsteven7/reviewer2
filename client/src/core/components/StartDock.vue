<script setup lang="ts">
import { ref } from 'vue';
import { reconnecting } from '../socket';
import { useStickyHeight } from '../useStickyHeight';
import { useStuck } from '../useStuck';

// The start bar of every game's waiting room (docs/rules/display.md#layout), which stays at the top
// of the screen as the page scrolls, under the room's masthead, so that the start button is at hand
// from the first screen to the foot of the desk: one line on whether the room is ready, or the
// first thing still missing (`readiness`, in red until it is `ready`), with what the `line` slot
// adds at its end, as the friends invited, and under it the buttons of the default slot, sharing
// their row evenly however many there are. A `member`'s bar, who doesn't chair the room, keeps the
// line and its one button on one row where they fit.
defineProps<{ readiness: string; ready: boolean; member?: boolean }>();

// The bar's height goes into the page's scroll padding, so that a field of the desk that takes the
// focus comes into view below it, however many rows the bar has.
const dock = ref<HTMLElement | null>(null);
useStickyHeight(dock);
const stuck = useStuck(dock);
</script>

<template>
  <div ref="dock" class="start-dock" :class="{ 'below-banner': reconnecting, stuck }">
    <div class="start-bar" :class="{ member }">
      <div class="ready-line">
        <p class="readiness" :class="{ ready }">{{ readiness }}</p>
        <slot name="line" />
      </div>
      <div class="start-actions">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The bar stays at the top of the screen as the page scrolls, under the room's masthead, which
   stays there too in the waiting room (--pinned-height, PageMasthead.vue), and under the banner
   while the page reconnects, as the game's clock does. Its background reaches the edges of the
   screen, as a masthead's does (PageMasthead.vue), and covers its own sticker's shadow, so that
   nothing shows through beside it, and nothing below it, where the shade falls on what passes under
   the bar. A field of the desk that the page brings into view stays below it: the bar's height, as
   measured (useStickyHeight), and the banner's go into the page's scroll padding. */
.start-dock {
  position: sticky;
  top: var(--pinned-height, 0px);
  z-index: 5;
  margin-bottom: var(--space-2);
  padding: var(--space-2) 0 var(--space-3);
  background: var(--bg);
  border-image: linear-gradient(var(--bg), var(--bg)) 0 fill / 0 / 0 100vmax;
}

/* The soft shadow under the bar while it is stuck under the masthead with the page passing under
   it, as under a page's masthead (PageMasthead.vue), which draws none while this bar stays under
   it: the lowest bar that stays has the shade. */
.start-dock::after {
  content: '';
  position: absolute;
  top: 100%;
  right: 0;
  left: 0;
  height: 12px;
  border-image: linear-gradient(var(--shade), transparent) 0 fill / 0 / 0 100vmax;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--motion);
}

.start-dock.stuck::after {
  opacity: 1;
}

.start-dock.below-banner {
  top: calc(var(--banner-height) + var(--pinned-height, 0px));
}

:global(html:has(.start-dock)) {
  scroll-padding-top: calc(var(--banner-height) + var(--pinned-height, 0px) + var(--sticky-height, 8rem));
}

/* One line for whether the room is ready, and the buttons under it, or beside it where there is
   room. The chair's buttons share their row evenly, two or three of them, or one that takes the
   row, and a long word wraps inside its button; on a wide screen they stand beside the line, all
   as wide. A member's bar keeps its line and its one button on one row where they fit, the line
   wrapping rather than cut off. */
.start-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
}

/* The line, with the avatars of the friends invited at its right end. */
.ready-line {
  display: flex;
  flex: 1 1 14rem;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.readiness {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--red-deep);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.readiness.ready {
  color: var(--ink);
}

.start-actions {
  display: grid;
  flex: 1 1 100%;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
  gap: var(--space-2);
}

.start-bar:not(.member) .ready-line {
  flex-basis: 100%;
}

.start-actions > :slotted(.button) {
  padding: 0 var(--space-2);
  white-space: normal;
  text-align: center;
}

.start-bar.member {
  column-gap: var(--space-2);
  padding-right: var(--space-3);
  padding-left: var(--space-3);
}

.member .ready-line {
  flex: 1 1 8rem;
}

.member .readiness {
  white-space: normal;
}

.member .start-actions {
  flex: none;
}

.member .start-actions > :slotted(.button) {
  padding: 0 var(--space-3);
}

@media (min-width: 40rem) {
  .start-bar:not(.member) .ready-line {
    flex: 1 1 14rem;
  }

  .start-bar:not(.member) .start-actions {
    flex: 0 1 auto;
    grid-auto-columns: 10rem;
  }
}
</style>
