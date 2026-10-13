import hyphenated from 'virtual:hyphenation';

// English words on cards are hyphenated with the en-us patterns of Liang's algorithm, the same
// ones TeX uses, because browsers can't be relied on for it: many don't hyphenate at all. The
// soft hyphens show only where a word actually breaks. The work is done at build time, for every
// English term of the word library (see the plugin in vite.config.ts): the page carries only the
// words that break, not the patterns, which weigh as much as the rest of the app.
//
// A word that the patterns leave whole, which they do with many a proper name and some plain
// words ("Wikipedia", "Premise", the "Doppler" of "Doppler effect"), and a word outside the
// library, such as one of the chair's own, gets the fallback below, word by word. Chinese
// characters are shown as they are; a Latin word in a Chinese term, such as "Kubernetes", gets
// the fallback too.
export function hyphenate(term: string): string {
  // Looked up as an own property: the map is a plain object, and a chair may well call a word
  // "constructor".
  const broken = (Object.hasOwn(hyphenated, term) ? hyphenated[term] : undefined) ?? term;
  // The patterns keep the spaces, so the words of the broken term and the term's own line up.
  return broken
    .split(' ')
    .map((word) => (word.includes(SOFT_HYPHEN) ? word : fallback(word)))
    .join(' ');
}

const SOFT_HYPHEN = '\u00ad';
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
