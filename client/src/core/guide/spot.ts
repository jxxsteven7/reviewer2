import { onBeforeUnmount, shallowRef, watch, type Ref } from 'vue';

// What the finger of the tutorial is at (GuideFinger.vue): the part of a step's scene that the step
// is about, and what the finger does there. It taps what the step asks the reader to tap, holds down
// what it asks them to hold, and points at what it only asks them to look at.

export type FingerKind = 'tap' | 'hold' | 'point';

export interface SpotTarget {
  // The part, found in the scene by this selector.
  selector: string;
  finger: FingerKind;
}

export const spot = shallowRef<{ el: Element; finger: FingerKind } | null>(null);

// How long the scene may take to draw the part, as a room setup does while the word lists come.
const TRIES = 20;
const TRY_MS = 100;
// How long the part is brought into sight again whenever the scene changes size, as one does that
// is still drawing what comes above the part.
const SETTLE_MS = 1500;

// Puts the finger on the part of the scene in `root` that `target` names, whenever either changes,
// once the scene has drawn it, and brings it into sight, after the router has scrolled the page for
// a step that it opened anew (router.ts), and again as the scene settles; with no target, or none to
// be found, there is no finger. A scene that goes takes its finger with it.
export function useSpot(root: Ref<HTMLElement | null>, target: () => SpotTarget | null): void {
  let round = 0;
  let settling: ResizeObserver | null = null;
  const stop = () => {
    round += 1;
    settling?.disconnect();
    settling = null;
  };
  watch(
    [root, target],
    async ([el, wanted]) => {
      stop();
      const mine = round;
      spot.value = null;
      if (!el || !wanted) return;
      for (let i = 0; i < TRIES; i += 1) {
        const found = el.querySelector(wanted.selector);
        if (found) {
          spot.value = { el: found, finger: wanted.finger };
          requestAnimationFrame(() => mine === round && bringIntoView(found));
          if (typeof ResizeObserver !== 'undefined') {
            settling = new ResizeObserver(() => mine === round && bringIntoView(found));
            settling.observe(el);
            setTimeout(() => mine === round && settling?.disconnect(), SETTLE_MS);
          }
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, TRY_MS));
        if (mine !== round) return;
      }
    },
    { immediate: true, flush: 'post' },
  );
  onBeforeUnmount(() => {
    stop();
    spot.value = null;
  });
}

// Scrolls the page so that the part stands in the middle of what the chapter's bar at the top and
// the coach card at the bottom leave of the screen, as a phone shows them; on a wider screen the
// coach card is beside the scene, and the part stands in the middle of what is under the bar.
function bringIntoView(el: Element): void {
  const top = document.querySelector('.guide-bar')?.getBoundingClientRect().bottom ?? 0;
  const coach = document.querySelector('.guide-coach')?.getBoundingClientRect();
  const bottom = coach && coach.top > window.innerHeight / 2 ? coach.top : window.innerHeight;
  const rect = el.getBoundingClientRect();
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  window.scrollTo({
    top: window.scrollY + rect.top + rect.height / 2 - (top + bottom) / 2,
    behavior: reduced ? 'auto' : 'smooth',
  });
}
