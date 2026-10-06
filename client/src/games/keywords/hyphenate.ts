import english from 'hyphen/en-us';

// English words on cards are hyphenated with the en-us patterns of Liang's algorithm, the same
// ones TeX uses, because browsers can't be relied on for it: many don't hyphenate at all. The
// soft hyphens it inserts show only where a word actually breaks. Chinese needs no hyphens.

const HAN = /\p{Script=Han}/u;
const cache = new Map<string, string>();

export function hyphenate(word: string): string {
  if (HAN.test(word)) return word;
  let hyphenated = cache.get(word);
  if (hyphenated === undefined) {
    hyphenated = english.hyphenateSync(word, { minWordLength: 6 });
    cache.set(word, hyphenated);
  }
  return hyphenated;
}
