import type { GameCounts } from '@reviewer2/shared';
import type { StatBlock } from '../../core/components/StatBlocks.vue';
import { winRate } from '../../core/rates';

type Translate = (key: string, named?: Record<string, unknown>, plural?: number) => string;

// The first game's record as counts (RecordStats.vue): six numbers, the games finished, in matches
// or not, the share of them won (rates.ts), the share won as a group's PI and as a student, each
// over how many games, which count every game as the total does, the matches finished, and how many
// of them the account finished first, level with others too.
export function recordStats(t: Translate, counts: GameCounts, locale: string): StatBlock[] {
  const { ordinary, inMatches, roles, matches } = counts;
  const total = { games: ordinary.games + inMatches.games, wins: ordinary.wins + inMatches.wins };
  const role = (key: 'captain' | 'guesser'): StatBlock => {
    const { games, wins } = roles[key] ?? { games: 0, wins: 0 };
    return {
      label: t(`account.profile.recordStats.${key}`),
      value: winRate(wins, games, locale),
      detail: t('account.profile.recordStats.gameCount', { count: games }, games),
    };
  };
  return [
    { label: t('account.profile.recordStats.games'), value: String(total.games) },
    { label: t('account.profile.recordStats.rate'), value: winRate(total.wins, total.games, locale) },
    role('captain'),
    role('guesser'),
    { label: t('account.profile.recordStats.matches'), value: String(matches.played) },
    { label: t('account.profile.recordStats.won'), value: String(matches.won) },
  ];
}
