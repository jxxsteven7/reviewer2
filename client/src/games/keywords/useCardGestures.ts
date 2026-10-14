import type { Mark } from '@reviewer2/shared';
import { onBeforeUnmount } from 'vue';

// How a student's taps on a card become what they mean (docs/games/keywords.md#talking-it-over):
// one tap chooses the card, two mark it as one of the group's own, three as one of the other
// group's, and holding it down marks it as maybe Reviewer 2. A tap waits a moment for the next
// before it counts, so that two taps don't choose the card first; three count at once. A press held
// long enough marks the card, and the click that ends it counts for nothing; one that moves away
// first, as when the page scrolls, is no press. From the keyboard, 1, 2 and 3 mark the card that
// has the focus, and Enter or Space taps it.
export const TAP_MS = 260;
export const HOLD_MS = 500;
const MOVE_PX = 10;

const KEYS: Record<string, Mark> = { '1': 'ours', '2': 'theirs', '3': 'r2' };
const BY_TAPS: Record<number, Mark> = { 2: 'ours', 3: 'theirs' };

export function useCardGestures(on: { tap: (card: number) => void; mark: (card: number, mark: Mark) => void }) {
  let taps: { card: number; count: number; timer: ReturnType<typeof setTimeout> } | null = null;
  let hold: { card: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
  // The card whose press was held long enough: the click that ends the press counts for nothing.
  let held: number | null = null;

  function settle() {
    if (!taps) return;
    const { card, count } = taps;
    clearTimeout(taps.timer);
    taps = null;
    const mark = BY_TAPS[Math.min(count, 3)];
    if (mark) on.mark(card, mark);
    else on.tap(card);
  }

  function click(card: number) {
    if (held === card) {
      held = null;
      return;
    }
    if (taps && taps.card !== card) settle();
    const count = (taps?.count ?? 0) + 1;
    if (taps) clearTimeout(taps.timer);
    taps = { card, count, timer: setTimeout(settle, TAP_MS) };
    if (count >= 3) settle();
  }

  function letGo() {
    if (hold) clearTimeout(hold.timer);
    hold = null;
  }

  function press(card: number, event: PointerEvent) {
    held = null;
    letGo();
    if (!event.isPrimary || event.button !== 0) return;
    hold = {
      card,
      x: event.clientX,
      y: event.clientY,
      timer: setTimeout(() => {
        hold = null;
        held = card;
        if (taps?.card === card) {
          clearTimeout(taps.timer);
          taps = null;
        }
        on.mark(card, 'r2');
      }, HOLD_MS),
    };
  }

  function move(event: PointerEvent) {
    if (hold && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > MOVE_PX) letGo();
  }

  function key(card: number, event: KeyboardEvent) {
    const mark = KEYS[event.key];
    if (!mark || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    on.mark(card, mark);
  }

  onBeforeUnmount(() => {
    if (taps) clearTimeout(taps.timer);
    letGo();
  });

  return { click, press, move, letGo, key };
}
