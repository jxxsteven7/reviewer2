<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import BackButton, { canGoBack } from './BackButton.vue';

// The bar of a page's title, under the masthead and above the page: the way back to the page before,
// when there is one (BackButton.vue), then the title. With the way back it stays at the top of the
// screen as the page scrolls, as tall as the masthead and on its yellow, which then scrolls away
// (PageMasthead.vue, `back`), with the masthead's soft shadow under it once it has reached the top:
// a page keeps one bar at the top, its own if it has one, and the masthead otherwise
// (docs/design.md). Without a page before, it scrolls with the page under the masthead that stays.
const pinned = canGoBack();
const bar = ref<HTMLElement | null>(null);
const stuck = ref(false);
const onScroll = () => {
  stuck.value = window.scrollY > 0 && (bar.value?.getBoundingClientRect().top ?? 1) <= 0;
};
onMounted(() => {
  if (!pinned) return;
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
});
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll));
</script>

<template>
  <div ref="bar" class="page-title" :class="{ pinned, stuck }">
    <BackButton />
    <h1><slot /></h1>
  </div>
</template>

<style scoped>
.page-title {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 64px;
}

h1 {
  min-width: 0;
  font-size: var(--text-2xl);
}

/* The masthead's yellow and shadow, from one edge of the screen to the other (PageMasthead.vue). */
.page-title.pinned {
  position: sticky;
  top: 0;
  z-index: 10;
  padding-top: env(safe-area-inset-top);
  border-image: linear-gradient(var(--bg), var(--bg)) 0 fill / 0 / 0 100vmax;
}

.page-title.pinned::after {
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

.page-title.stuck::after {
  opacity: 1;
}

/* What the page scrolls to stops below the bar, as below a masthead that stays. */
:global(html:has(:where(.page-title.pinned))) {
  scroll-padding-top: calc(64px + env(safe-area-inset-top) + var(--space-3));
}
</style>
