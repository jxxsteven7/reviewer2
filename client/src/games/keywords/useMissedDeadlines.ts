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
// Each turn that the record gains whose PI gave no clue in time is called out as the snapshots
// bring it, and none that was there when the page opened. The count comes with the event of the
// missed deadline. A PI who is no longer in the room isn't called out: there is nobody to name.
export function useMissedDeadlines(game: Ref<KeywordsView | null>, players: Ref<readonly PlayerView[]>): void {
  const { t } = useI18n();
  watch(
    () => game.value?.history.length ?? 0,
    (length, before) => {
      if (!game.value || length <= before) return;
      const { gameId, history, events } = game.value;
      for (const record of history.slice(before)) {
        if (record.word !== null || !record.timedOut || record.captain === undefined) continue;
        const player = players.value.find(({ id }) => id === record.captain);
        if (!player) continue;
        const count = events.find((event) => event.kind === 'missed' && event.turn === record.turn)?.count;
        const line = t(`game.missed.lines.${missedLine(gameId, record.turn)}`, { name: player.name });
        callOut(player, count === undefined ? line : t('game.missed.count', { line, count }), 'deadline');
      }
    },
  );
}
