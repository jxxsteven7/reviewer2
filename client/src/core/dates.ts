// Dates as the page's language writes them, or as ISO when the browser's Intl can't.

// The day of a date (YYYY-MM-DD) or of a timestamp, as UTC: the day an account registered is the
// same wherever the page is opened, and the same on the account's own page, which has the moment,
// and on its public page, which has the day alone (docs/architecture.md#public-profiles).
export function formatDay(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

// A moment as numbers alone, where the page is, the same in every language: the day as
// 2026.10.14 and the time as 18:08, for the lines of an account's record.
export function formatStamp(iso: string): { day: string; time: string } {
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return { day: iso.slice(0, 10).replaceAll('-', '.'), time: '' };
  const two = (value: number) => String(value).padStart(2, '0');
  return {
    day: `${moment.getFullYear()}.${two(moment.getMonth() + 1)}.${two(moment.getDate())}`,
    time: `${two(moment.getHours())}:${two(moment.getMinutes())}`,
  };
}
