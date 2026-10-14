import type { KeywordsView } from '@reviewer2/shared';
import { watch, type Ref } from 'vue';
import { connection } from '../../core/socket';

// The snapshots of a game that come in front of the viewer, each with the one before it: on the
// same connection, so that the snapshot that comes with a new one, as after a reload or a locked
// screen, catches the page up without a word, and while the page is in sight. What the game shows
// of the moment comes of these: the points that rise (useScoreFloats.ts) and the deadline heroes
// called out (useDeadlineHeroes.ts). The view that the page opens with is the first to compare
// with, and brings nothing itself; so does the first view of another game.
export function useLiveViews(
  game: Ref<KeywordsView | null | undefined>,
  on: (last: KeywordsView, view: KeywordsView) => void,
): void {
  let before: { view: KeywordsView; connects: number } | null = null;
  watch(
    game,
    (view) => {
      const last = before;
      before = view ? { view, connects: connection.connects } : null;
      if (!view || !last || last.connects !== connection.connects || document.visibilityState === 'hidden') return;
      on(last.view, view);
    },
    { immediate: true },
  );
}
