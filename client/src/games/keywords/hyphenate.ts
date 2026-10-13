import hyphenated from 'virtual:hyphenation';

// English words on cards are hyphenated with the en-us patterns of Liang's algorithm, the same
// ones TeX uses, because browsers can't be relied on for it: many don't hyphenate at all. The
// soft hyphens show only where a word actually breaks. The work is done at build time, for every
// English term of the word library (see the plugin in vite.config.ts): the page carries only the
// words that break, not the patterns, which weigh as much as the rest of the app.
//
// A word that the patterns leave whole, which they do with many a proper name and some plain
// words ("Wikipedia", "Premise"), and a word outside the library, such as one of the chair's own,
// gets the fallback below. Every Chinese word is shown as it is.
export const hyphenate = (word: string): string => hyphenated[word] ?? fallback(word);

const SOFT_HYPHEN = '­';
// The fewest letters a piece keeps at either end of a word that breaks by the fallback.
const KEEP = 3;

// A word of six Latin letters or more may break between any two letters that leave at least three
// on each side, so that a card never shows a word cut before its last letter or two, which a browser
// does on its own when it has nothing else. The browser breaks only where the word doesn't fit,
// and as late in the word as it can.
function fallback(word: string): string {
  return word.replace(/\p{Script=Latin}{6,}/gu, (run) =>
    [...run]
      .map((letter, index, letters) =>
        index >= KEEP && index <= letters.length - KEEP ? SOFT_HYPHEN + letter : letter,
      )
      .join(''),
  );
}
