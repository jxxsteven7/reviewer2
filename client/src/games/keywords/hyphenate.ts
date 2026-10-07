import hyphenated from 'virtual:hyphenation';

// English words on cards are hyphenated with the en-us patterns of Liang's algorithm, the same
// ones TeX uses, because browsers can't be relied on for it: many don't hyphenate at all. The
// soft hyphens show only where a word actually breaks. The work is done at build time, for every
// English term of the word library (see the plugin in vite.config.ts): the page carries only the
// words that break, not the patterns, which weigh as much as the rest of the app. A word the
// library doesn't have, and every Chinese word, is shown as it is.
export const hyphenate = (word: string): string => hyphenated[word] ?? word;
