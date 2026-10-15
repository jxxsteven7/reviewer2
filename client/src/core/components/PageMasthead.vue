<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import BackButton, { canGoBack } from './BackButton.vue';
import SiteWordmark from './SiteWordmark.vue';

// The header of a page: the wordmark, and what the page puts at the other end. A room's
// masthead is `compact`: on a narrow screen its wordmark is the tile alone, and it scrolls away
// with the page, which keeps bars of its own at the top of the screen (the clock), unless it is
// `pinned`, as in the waiting room, where it stays, and the bars that stay go under it
// (--pinned-height). Every other page's stays at the top as the page scrolls, on the table's yellow
// from one edge of the screen to the other, with a soft shadow under it once the page has scrolled. A page that has
// a way `back` to the page before, as the account page and a player's page, has it at the very
// start, before the wordmark, where it stays in reach however far the page has scrolled; on the
// narrowest phones the wordmark is then the tile alone (SiteWordmark.vue).
const props = withDefaults(defineProps<{ compact?: boolean; pinned?: boolean; back?: boolean }>(), {
  compact: false,
  pinned: false,
  back: false,
});
const stays = computed(() => !props.compact || props.pinned);
const backward = props.back && canGoBack();
const scrolled = ref(false);
const onScroll = () => {
  scrolled.value = window.scrollY > 0;
};
onMounted(() => {
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
});
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll));
</script>

<template>
  <header class="masthead" :class="{ sticky: stays, pinned, scrolled: stays && scrolled }">
    <div class="start">
      <BackButton v-if="backward" />
      <SiteWordmark :compact="compact" :tight="backward" />
    </div>
    <div class="end"><slot /></div>
  </header>
</template>

<style scoped>
.masthead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: 64px;
  padding-top: env(safe-area-inset-top);
}

.start {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
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

/* A room's masthead that stays sits under the banner while the page reconnects, and is as tall as
   any other, which the bars that stay under it go by. */
.masthead.pinned.below-banner {
  top: var(--banner-height);
}

:global(html:has(.masthead.pinned)) {
  --pinned-height: calc(64px + env(safe-area-inset-top));
}

.pinned .end {
  flex-wrap: nowrap;
}

/* What the page scrolls to, a link's target or the field that takes the focus, stops below the
   masthead rather than under it, and below the bars that stay with it, which say so for
   themselves. */
:global(html:has(:where(.masthead.sticky))) {
  scroll-padding-top: calc(64px + env(safe-area-inset-top) + var(--space-3));
}
</style>
