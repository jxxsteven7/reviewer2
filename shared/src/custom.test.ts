import { describe, expect, test } from 'vitest';
import { CARD_HAN, CARD_LETTERS, fitsCard, MAX_CUSTOM_INPUT, MAX_CUSTOM_WORDS, parseCustomWords } from './custom';

// Chinese fixtures are written as \u escapes (docs/rules/language.md).
const GENE = '\u57fa\u56e0'; // "gene"
const DATA = '\u6570\u636e'; // "data"
const WORD = '\u8bcd'; // "word"
const ENUMERATION_COMMA = '\u3001';
const FULL_WIDTH_COMMA = '\uff0c';
// Characters that show nothing, which a pasted word may carry.
const SOFT_HYPHEN = '\u00ad';
const ZERO_WIDTH_SPACE = '\u200b';

describe("the chair's own words", () => {
  test('come one per line, or separated by commas or the Chinese enumeration comma', () => {
    const { words } = parseCustomWords(
      `Alpha\nBeta, Gamma${ENUMERATION_COMMA}Delta${FULL_WIDTH_COMMA}${GENE}\r\nEpsilon`,
    );
    expect(words).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta', GENE, 'Epsilon']);
  });

  test('are cleaned as clues are, and the same word twice is one word', () => {
    const { words } = parseCustomWords(' Self-Attention \n\nself attention\nSELF-ATTENTION\n  \nGene  editing\n+++\n');
    expect(words).toEqual(['Self-Attention', 'Gene editing']);
    expect(parseCustomWords(`Gra${SOFT_HYPHEN}di${ZERO_WIDTH_SPACE}ent`).words).toEqual(['Gradient']);
  });

  test('must fit on a card: 5 Chinese characters or 14 other characters', () => {
    expect(fitsCard(WORD.repeat(CARD_HAN))).toBe(true);
    expect(fitsCard(WORD.repeat(CARD_HAN + 1))).toBe(false);
    expect(fitsCard('a'.repeat(CARD_LETTERS))).toBe(true);
    expect(fitsCard('a'.repeat(CARD_LETTERS + 1))).toBe(false);
    expect(fitsCard(`GPU${DATA}`)).toBe(true);
    const parsed = parseCustomWords(`Fine\nFourteenletters\n${WORD.repeat(6)}`);
    expect(parsed.words).toEqual(['Fine']);
    expect(parsed.tooLong).toEqual(['Fourteenletters', WORD.repeat(6)]);
    expect(parsed.tooMany).toBe(false);
  });

  test('are at most 200, and come from a text of at most 10,000 characters', () => {
    const many = Array.from({ length: MAX_CUSTOM_WORDS + 1 }, (_, i) => `w${i}`);
    expect(parseCustomWords(many.join(','))).toMatchObject({ tooMany: true });
    expect(parseCustomWords(many.slice(0, MAX_CUSTOM_WORDS).join(','))).toMatchObject({ tooMany: false });
    expect(parseCustomWords('a'.repeat(MAX_CUSTOM_INPUT + 1))).toEqual({ words: [], tooLong: [], tooMany: false });
    expect(parseCustomWords(42 as unknown as string)).toEqual({ words: [], tooLong: [], tooMany: false });
  });
});
