import type { GameCounts } from '@reviewer2/shared';
import { IMPOSTOR_ROLES } from '@reviewer2/shared/impostor';
import type { StatBlock } from '../../core/components/StatBlocks.vue';
import { NO_RATE, winRate } from '../../core/rates';

type Translate = (key: string, named?: Record<string, unknown>, plural?: number) => string;

// The hidden word game's record as counts (RecordStats.vue), three to a line: the games finished,
// the share of them won, and the share of the account's votes that went to a Reviewer 2 or the PI;
// the share won as a student, as a Reviewer 2 and as the PI, each over how many games; and the
// rounds lasted on average, to one decimal place, the times out for breaking the rules, and the
// games the account set the words of, with their good ratings (docs/games/impostor.md#the-setter);
// and the matches finished, and those finished first, as the first game has them. What the records
// add up comes from the server (GameCounts.sums).
export function recordStats(t: Translate, counts: GameCounts, locale: string): StatBlock[] {
  const { ordinary, inMatches, roles, matches, sums = {}, wordsSet } = counts;
  const total = { games: ordinary.games + inMatches.games, wins: ordinary.wins + inMatches.wins };
  const sum = (key: string) => sums[key] ?? 0;
  const role = (key: string): StatBlock => {
    const { games, wins } = roles[key] ?? { games: 0, wins: 0 };
    return {
      label: t(`games.impostor.roles.${key}`),
      value: winRate(wins, games, locale),
      detail: t('account.profile.recordStats.gameCount', { count: games }, games),
    };
  };
  const rounds = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return [
    { label: t('account.profile.recordStats.games'), value: String(total.games) },
    { label: t('account.profile.recordStats.rate'), value: winRate(total.wins, total.games, locale) },
    {
      label: t('games.impostor.stats.hits'),
      value: winRate(sum('hits'), sum('votes'), locale),
      detail: t('games.impostor.stats.votes', { count: sum('votes') }, sum('votes')),
    },
    ...IMPOSTOR_ROLES.map(role),
    {
      label: t('games.impostor.stats.rounds'),
      value: total.games > 0 ? rounds.format(sum('rounds') / total.games) : NO_RATE,
    },
    { label: t('games.impostor.stats.violations'), value: String(sum('violation')) },
    {
      label: t('games.impostor.stats.wordsSet'),
      value: t('games.impostor.stats.wordsSetValue', { games: wordsSet?.games ?? 0, good: wordsSet?.good ?? 0 }),
    },
    { label: t('account.profile.recordStats.matches'), value: String(matches.played) },
    { label: t('account.profile.recordStats.won'), value: String(matches.won) },
  ];
}
