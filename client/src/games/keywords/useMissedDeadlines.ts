import type { KeywordsView, PlayerView } from '@reviewer2/shared';
import { watch, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { callOut } from '../../core/emotes';
import { missedLine } from './missed';

// A PI whose time for a clue runs out is called out to the whole room at once, the PI included,
// and the screens too (docs/games/keywords.md#titles): a teasing line about the missed deadline
// (missed.ts), with the PI's name and, for an account, how many times they have missed one, this
// time included, to the sound of the "deadline" reaction.
//
// The call is for the moment, so a snapshot calls out a missed deadline only when it has just
// happened: the newest turn of the record is one whose PI gave no clue in time, it wasn't there in
// the snapshot before, the game is still on, and the next turn's clock, when it has one, has only
// just started. A page that comes back after a while, with a locked phone, say, hears nothing of the
// misses it slept through, and nothing of a miss on record when the page opened. A snapshot of
// another game starts over, so that a page that slept through the end of one game and the start of
// the next calls out nothing of the new one's past. The count comes with the event of the missed
// deadline. A PI who is no longer in the room isn't called out: there is nobody to name.
export const FRESH_MS = 5000;

export function useMissedDeadlines(game: Ref<KeywordsView | null>, players: Ref<readonly PlayerView[]>): void {
  const { t } = useI18n();
  watch(
    () => [game.value?.gameId ?? null, game.value?.history.length ?? 0] as const,
    ([gameId, length], [gameBefore, before]) => {
      const view = game.value;
      if (!view || gameId !== gameBefore || length <= before || view.result) return;
      const record = view.history.at(-1);
      if (!record || record.word !== null || !record.timedOut || record.captain === undefined) return;
      if (view.clock && view.clock.total - view.clock.left > FRESH_MS) return;
      const player = players.value.find(({ id }) => id === record.captain);
      if (!player) return;
      const count = view.events.find((event) => event.kind === 'missed' && event.turn === record.turn)?.count;
      const line = t(`game.missed.lines.${missedLine(view.gameId, record.turn)}`, { name: player.name });
      callOut(player, count === undefined ? line : t('game.missed.count', { line, count }), 'deadline');
    },
  );
}
