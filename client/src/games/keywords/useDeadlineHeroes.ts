import type { GameEvent, KeywordsView, PlayerView } from '@reviewer2/shared';
import type { Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { callOut } from '../../core/emotes';
import { revealedBetween } from './floats';
import { heroLine } from './heroes';
import { useLiveViews } from './useLiveViews';

// A PI or a student who becomes a deadline hero is called out to the whole room at once, the
// screens too (docs/games/keywords.md#titles): a line about beating the deadline (heroes.ts), with
// the name and, for an account that has been one before, how many times it has been one, this time
// included, to the sound of the "accept" reaction.
//
// The call is for the moment: only the card that has just made them one calls them out, in a
// snapshot that comes in front of the viewer (useLiveViews.ts) with that one card more face up than
// the one before it (revealedBetween). A page that catches up, after a reload or a locked screen,
// or that is out of sight, hears nothing of the heroes it slept through. A player who is no longer
// in the room isn't called out.
const heroKey = (event: GameEvent): string => `${event.turn}:${event.player ?? ''}`;

export function useDeadlineHeroes(game: Ref<KeywordsView | null>, players: Ref<readonly PlayerView[]>): void {
  const { t } = useI18n();
  useLiveViews(game, (last, view) => {
    if (!revealedBetween(last, view)) return;
    const known = new Set(last.events.filter((event) => event.kind === 'hero').map(heroKey));
    for (const event of view.events) {
      if (event.kind !== 'hero' || event.player === undefined || known.has(heroKey(event))) continue;
      const player = players.value.find(({ id }) => id === event.player);
      if (!player) continue;
      const line = t(`game.hero.lines.${heroLine(view.gameId, event.turn, event.player)}`, { name: player.name });
      const count = event.count ?? 1;
      callOut(player, count === 1 ? line : t('game.hero.count', { line, count }), 'accept');
    }
  });
}
