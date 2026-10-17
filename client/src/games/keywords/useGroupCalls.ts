import type { KeywordsView } from '@reviewer2/shared';
import type { Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { callOutGroup } from '../../core/emotes';
import { CALL_SOUNDS, callLine, GROUP_CALLS, JUDGES } from './calls';
import { revealedBetween } from './floats';
import { useLiveViews } from './useLiveViews';

// A group that earns a title together is called out to the whole room at once, the screens too
// (docs/games/keywords.md#titles): a line about the group (calls.ts), as a deadline hero is called
// out (useDeadlineHeroes.ts), with the card that brings the title: the one that makes the opening
// record, the one that wins the heavenly hand, and Reviewer 2 for the instant desk reject and the
// fall at the first hurdle, which end the game.
//
// The call is for the moment: only the card that has just brought the title calls the group out,
// in a snapshot that comes in front of the viewer (useLiveViews.ts) with that one card more face up
// than the one before it (revealedBetween). A page that catches up, after a reload or a locked
// screen, or that is out of sight, hears nothing of it. The page judges the title from the record
// as the server does (shared/src/games/keywords/titles.ts), so nothing is sent for it.
export function useGroupCalls(game: Ref<KeywordsView | null>): void {
  const { t } = useI18n();
  useLiveViews(game, (last, view) => {
    const reveal = revealedBetween(last, view);
    if (!reveal) return;
    for (const call of GROUP_CALLS) {
      if (!JUDGES[call](view, reveal.by) || JUDGES[call](last, reveal.by)) continue;
      const group = t(`lobby.group.${reveal.by}`);
      const line = t(`game.calls.${call}.${callLine(view.gameId, view.turn, call)}`, { group });
      callOutGroup(reveal.by, group, line, CALL_SOUNDS[call]);
    }
  });
}
