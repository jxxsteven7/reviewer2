import type { Mark } from '@reviewer2/shared';
import { onBeforeUnmount, ref } from 'vue';

// How a student's taps on a card become what they mean (docs/games/keywords.md#talking-it-over): a
// tap chooses the card at once, whatever marks it has, and holding it down opens the menu of marks
// for it (MarkMenu.vue), as a right click does with a mouse. While the press is held, the card sinks
// into its shadow (`pressing`); a card that takes no mark (`holds`) neither sinks nor opens a menu.
// A press held long enough opens the menu, and the click that ends it counts for nothing; one that
// moves away first, as when the page scrolls, is no press. From the keyboard, 1, 2 and 3 mark the
// card that has the focus, and Enter or Space taps it: a key ends whatever press there was, so the
// tap counts.
export const HOLD_MS = 400;
const MOVE_PX = 10;

const KEYS: Record<string, Mark> = { '1': 'ours', '2': 'theirs', '3': 'r2' };

export function useCardGestures(on: {
  tap: (card: number) => void;
  holds: (card: number) => boolean;
  hold: (card: number) => void;
  mark: (card: number, mark: Mark) => void;
}) {
  let hold: { card: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
  // The card whose press was held long enough: the click that ends the press counts for nothing.
  let held: number | null = null;
  // Whether the last press came from a mouse, whose right click opens the menu at once.
  let mouse = false;
  // The card that is being pressed, until the press ends, moves away or opens the menu.
  const pressing = ref<number | null>(null);

  function click(card: number) {
    if (held === card) {
      held = null;
      return;
    }
    on.tap(card);
  }

  function letGo() {
    if (hold) clearTimeout(hold.timer);
    hold = null;
    pressing.value = null;
  }

  function press(card: number, event: PointerEvent) {
    held = null;
    letGo();
    mouse = event.pointerType === 'mouse';
    if (!event.isPrimary || event.button !== 0 || !on.holds(card)) return;
    pressing.value = card;
    hold = {
      card,
      x: event.clientX,
      y: event.clientY,
      timer: setTimeout(() => {
        hold = null;
        held = card;
        pressing.value = null;
        on.hold(card);
      }, HOLD_MS),
    };
  }

  function move(event: PointerEvent) {
    if (hold && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > MOVE_PX) letGo();
  }

  // A long press on a phone opens no menu of the browser's, and a mouse's right click opens ours,
  // also where the right click is a press with a key held, as on a Mac with Control: that press is
  // over then.
  function contextMenu(card: number, event: Event) {
    event.preventDefault();
    if (!mouse) return;
    letGo();
    held = null;
    on.hold(card);
  }

  function key(card: number, event: KeyboardEvent) {
    held = null;
    const mark = KEYS[event.key];
    if (!mark || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    on.mark(card, mark);
  }

  onBeforeUnmount(letGo);

  return { click, press, move, letGo, contextMenu, key, pressing };
}
