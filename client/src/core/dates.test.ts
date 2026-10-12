import { afterEach, describe, expect, test } from 'vitest';
import { formatDay, formatMoment } from './dates';

const zone = process.env.TZ;

afterEach(() => {
  process.env.TZ = zone;
});

describe('a day', () => {
  test('is written in the language of the page, as UTC wherever the page is', () => {
    expect(formatDay('2026-10-01', 'en')).toBe('Oct 1, 2026');
    expect(formatDay('2026-10-01T23:59:00.000Z', 'en')).toBe('Oct 1, 2026');
    expect(formatDay('2026-10-01', 'zh')).toBe('2026年10月1日');
    // West of Greenwich, the day of a date is still that day, not the evening before.
    process.env.TZ = 'America/New_York';
    expect(formatDay('2026-10-01', 'en')).toBe('Oct 1, 2026');
    expect(formatDay('2026-10-01T00:30:00.000Z', 'en')).toBe('Oct 1, 2026');
  });

  test('is the ISO day when the browser can not write it', () => {
    expect(formatDay('2026-10-01T23:59:00.000Z', 'no such locale')).toBe('2026-10-01');
    expect(formatDay('2026-10-01', 'no such locale')).toBe('2026-10-01');
  });
});

describe('a moment', () => {
  test('is written in the language of the page, in its time zone, or as ISO', () => {
    process.env.TZ = 'Asia/Shanghai';
    expect(formatMoment('2026-10-01T23:59:00.000Z', 'en')).toBe('Oct 2, 2026, 7:59 AM');
    expect(formatMoment('2026-10-01T23:59:00.000Z', 'no such locale')).toBe('2026-10-01 23:59');
  });
});
