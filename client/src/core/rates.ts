// The share of games won, as the pages show it (docs/architecture.md#accounts): a whole percentage
// rounded down, so that 100% is a record without a loss, which a record without games doesn't
// have: that shows a dash.
export const NO_RATE = '—';

export function winRate(wins: number, games: number, locale: string): string {
  if (games === 0) return NO_RATE;
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  return percent.format(Math.floor((wins * 100) / games) / 100);
}
