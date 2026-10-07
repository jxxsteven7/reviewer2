import { describe, expect, test } from 'vitest';
import { hyphenate } from './hyphenate';

const SOFT_HYPHEN = '\u00ad';

describe('hyphenate', () => {
  test('breaks the English terms of the word library with soft hyphens', () => {
    expect(hyphenate('Peer review')).toBe(`Peer re${SOFT_HYPHEN}view`);
    expect(hyphenate('Significance')).toBe(`Sig${SOFT_HYPHEN}nif${SOFT_HYPHEN}i${SOFT_HYPHEN}cance`);
  });

  test('leaves short words, words outside the library and Chinese words as they are', () => {
    expect(hyphenate('Model')).toBe('Model');
    expect(hyphenate('Serendipity')).toBe('Serendipity');
    expect(hyphenate('\u540c\u884c\u8bc4\u5ba1')).toBe('\u540c\u884c\u8bc4\u5ba1');
  });
});
