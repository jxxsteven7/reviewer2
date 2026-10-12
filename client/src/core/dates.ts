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

// A moment, as the date and the time where the page is.
export function formatMoment(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}
