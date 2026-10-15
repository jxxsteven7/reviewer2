import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue';

// A bar that sticks to the top of the screen, such as a game's clock or the chair's start bar in
// the waiting room, would cover whatever the page scrolls or focuses into view, unless the page's
// scroll padding leaves room for it. The bar's height, as measured whenever it changes, goes into
// `--sticky-height` on the root, which the page's scroll-padding-top adds to the banner's height.
// The bar may come and go; without one, the property goes. A browser without ResizeObserver keeps
// the stylesheet's guess.
//
// The scroll padding brings a field that takes the focus into view below the bar where the field
// was out of sight. One that was in sight, but under the bar, stays there in WebKit, which scrolls
// only for what is out of the viewport: so the page scrolls it out from under the bar itself. Only
// what comes after the bar on the page can be under it; what comes before, as the masthead's
// buttons, is left alone.
export function useStickyHeight(bar: Ref<HTMLElement | null>): void {
  const uncover = (event: FocusEvent) => {
    const field = event.target;
    const sticky = bar.value;
    if (!sticky || !(field instanceof Element) || sticky.contains(field)) return;
    if (!(sticky.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING)) return;
    const covered = sticky.getBoundingClientRect().bottom - field.getBoundingClientRect().top;
    if (covered > 0) window.scrollBy({ top: -covered, behavior: 'instant' });
  };
  onMounted(() => document.addEventListener('focusin', uncover));
  onBeforeUnmount(() => document.removeEventListener('focusin', uncover));

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
