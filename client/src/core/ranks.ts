import { nextRank } from '@reviewer2/shared';

// A component's translator, as far as the line needs it.
type Translate = (key: string, named?: Record<string, string | number>) => string;

// The way up from these points, as the account page and the ladder say it under the rank
// (shared/src/ranks.ts): how far the next rank is, or that this is the top.
export const wayUp = (t: Translate, points: number): string => {
  const next = nextRank(points);
  return next ? t('ranks.next', { points: next.points, rank: t(`ranks.names.${next.rank}`) }) : t('ranks.top');
};
