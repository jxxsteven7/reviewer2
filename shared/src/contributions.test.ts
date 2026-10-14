import { describe, expect, test } from 'vitest';
import { checkSummary, MAX_SUMMARY_INPUT, MAX_SUMMARY_LENGTH } from './contributions';

// What the operator writes of a contribution, in either language.

const HAN = '\u5b57'; // a Chinese character, one of the characters that a reader sees
const ZERO_WIDTH_SPACE = '\u200b';

describe('a summary of a contribution', () => {
  test('is one line of plain text, cleaned as a bio is', () => {
    expect(checkSummary('  Suggested\tmarking cards\nwith taps  ')).toEqual({
      summary: 'Suggested marking cards with taps',
      problem: null,
    });
    expect(checkSummary(`${HAN}${ZERO_WIDTH_SPACE}${HAN}`)).toEqual({ summary: `${HAN}${HAN}`, problem: null });
  });

  test('is needed', () => {
    for (const text of [undefined, '', '   ', ZERO_WIDTH_SPACE, 7 as unknown as string]) {
      expect(checkSummary(text), JSON.stringify(text)).toEqual({ summary: null, problem: 'summary_missing' });
    }
  });

  test(`has at most ${MAX_SUMMARY_LENGTH} characters that a reader sees`, () => {
    expect(checkSummary(HAN.repeat(MAX_SUMMARY_LENGTH)).problem).toBeNull();
    expect(checkSummary(HAN.repeat(MAX_SUMMARY_LENGTH + 1))).toEqual({
      summary: HAN.repeat(MAX_SUMMARY_LENGTH + 1),
      problem: 'summary_too_long',
    });
    expect(checkSummary(' '.repeat(MAX_SUMMARY_INPUT + 1))).toEqual({ summary: null, problem: 'summary_too_long' });
  });
});
