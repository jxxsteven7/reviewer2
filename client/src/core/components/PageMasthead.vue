<script setup lang="ts">
import { computed, ref } from 'vue';
import { useScrolled } from '../useScrolled';
import { canGoBack } from './BackButton.vue';
import SiteWordmark from './SiteWordmark.vue';

// The header of a page: the wordmark, and what the page puts at the other end. A room's
// masthead is `compact`: on a narrow screen its wordmark is the tile alone, and it scrolls away
// with the page, which keeps bars of its own at the top of the screen (the clock), unless it is
// `pinned`, as in the waiting room, where it stays, and the bars that stay go under it
// (--pinned-height). Every other page's stays at the top as the page scrolls, on the table's yellow
// from one edge of the screen to the other, with a soft shadow under it once the page has scrolled.
// The wordmark stands in the same place on every page. A page with a way `back` to the page before,
// as the account page and a player's page, has it on the bar of its title (PageTitle.vue), which
// takes the top of the screen when there is a page before, and the masthead then scrolls away: a
// page keeps one bar at the top (docs/design.md).
const props = withDefaults(defineProps<{ compact?: boolean; pinned?: boolean; back?: boolean }>(), {
  compact: false,
  pinned: false,
  back: false,
});
const yields = props.back && canGoBack();
const stays = computed(() => (!props.compact || props.pinned) && !yields);
// A masthead that scrolls away has no shade to draw, and no scrolling to watch.
const scrolled = yields ? ref(false) : useScrolled();
</script>

<template>
  <header class="masthead" :class="{ sticky: stays, pinned, scrolled: stays && scrolled }">
    <SiteWordmark :compact="compact" />
    <div class="end"><slot /></div>
  </header>
</template>

<style scoped>
.masthead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: var(--masthead-height);
  padding-top: env(safe-area-inset-top);
}

.end {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  min-width: 0;
}

/* The yellow and the shadow reach past the page's column to the edges of the screen as border
   images, which add nothing to scroll sideways, as a box as wide as the screen would beside a
   desktop's scrollbar. */
.masthead.sticky {
  position: sticky;
  top: 0;
  z-index: 10;
  border-image: linear-gradient(var(--bg), var(--bg)) 0 fill / 0 / 0 100vmax;
}

.masthead.sticky::after {
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

.masthead.scrolled::after {
  opacity: 1;
}

/* In a waiting room, the chair's start bar stays under the masthead, and once it is stuck there it
   draws the shade itself (KeywordsLobby.vue): the lowest bar that is stuck has it. The whole
   selector is global: a scoped selector can't reach the html element, and a `:global()` that stops
   before the masthead's own part would be compiled down to the html element alone. */
:global(html:has(.start-dock.stuck) .masthead.scrolled::after) {
  opacity: 0;
}

/* A room's masthead that stays sits under the banner while the page reconnects, and is as tall as
   any other, which the bars that stay under it go by. */
.masthead.pinned.below-banner {
  top: var(--banner-height);
}

:global(html:has(.masthead.pinned)) {
  --pinned-height: calc(var(--masthead-height) + env(safe-area-inset-top));
}

.pinned .end {
  flex-wrap: nowrap;
}

/* What the page scrolls to, a link's target or the field that takes the focus, stops below the
   masthead rather than under it, and below the bars that stay with it, which say so for
   themselves. */
:global(html:has(:where(.masthead.sticky))) {
  scroll-padding-top: calc(var(--masthead-height) + env(safe-area-inset-top) + var(--space-3));
}
</style>
