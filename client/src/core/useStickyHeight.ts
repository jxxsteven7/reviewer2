import { onBeforeUnmount, watch, type Ref } from 'vue';

// A bar that sticks to the top of the screen, such as a game's clock or the chair's start bar in
// the waiting room, would cover whatever the page scrolls or focuses into view, unless the page's
// scroll padding leaves room for it. The bar's height, as measured whenever it changes, goes into
// `--sticky-height` on the root, which the page's scroll-padding-top adds to the banner's height.
// The bar may come and go; without one, the property goes. A browser without ResizeObserver keeps
// the stylesheet's guess.
export function useStickyHeight(bar: Ref<HTMLElement | null>): void {
  if (typeof ResizeObserver === 'undefined') return;
  const root = document.documentElement;
  const observer = new ResizeObserver(([entry]) => {
    if (entry) root.style.setProperty('--sticky-height', `${(entry.target as HTMLElement).offsetHeight}px`);
  });
  watch(
    bar,
    (now, before) => {
      if (before) observer.unobserve(before);
      if (now) observer.observe(now);
      else root.style.removeProperty('--sticky-height');
    },
    { flush: 'post' },
  );
  onBeforeUnmount(() => {
    observer.disconnect();
    root.style.removeProperty('--sticky-height');
  });
}
