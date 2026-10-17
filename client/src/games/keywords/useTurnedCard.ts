import type { CardView, KeywordsView } from '@reviewer2/shared';
import { onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { turnedBetween } from './floats';
import { useLiveViews } from './useLiveViews';

// How long a card that has just been turned face up keeps its turn: the flip and, on Reviewer 2,
// the stamp that follows it (KeywordsCard.vue), with a little to spare.
export const TURN_MS = 1000;

// The card that has just been turned face up in front of the viewer, by its number on the board,
// which turns over there (KeywordsCard.vue), with the face it had until then. Only a card revealed
// in front of the viewer turns, as only such a card's points rise (useScoreFloats.ts): a snapshot
// that comes with a new connection, as after a reload or a locked screen, or while the page is out
// of sight, catches the page up without a word (useLiveViews.ts), and so does one with several
// cards revealed at once, or one across a pause, which hides the board. The turn is over after
// TURN_MS, so that a board shown again later, as after a pause, shows the card as it lies.
function turning(): { turned: Ref<number | null>; turn: (card: number) => void } {
  const turned = ref<number | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  function turn(card: number) {
    if (timer !== null) clearTimeout(timer);
    turned.value = card;
    timer = setTimeout(() => {
      turned.value = null;
      timer = null;
    }, TURN_MS);
  }
  onBeforeUnmount(() => {
    if (timer !== null) clearTimeout(timer);
  });
  return { turned, turn };
}

// In a game: the card that a snapshot in front of the viewer has face up and the one before it
// didn't (turnedBetween in floats.ts).
export function useTurnedCard(game: Ref<KeywordsView | null | undefined>): Ref<number | null> {
  const { turned, turn } = turning();
  useLiveViews(game, (last, view) => {
    if (last.gameId !== view.gameId || last.paused || view.paused) return;
    const card = turnedBetween(last.cards, view.cards);
    if (card !== null) turn(card);
  });
  return turned;
}

// In a replay (ReplayViewer.vue): a step with one card more face up than the step shown before it
// turns that card over, as the game did; a jump over several reveals, or back, turns nothing.
export function useTurnedSteps(cards: Ref<readonly CardView[]>): Ref<number | null> {
  const { turned, turn } = turning();
  watch(cards, (after, before) => {
    const card = turnedBetween(before, after);
    if (card !== null) turn(card);
  });
  return turned;
}
