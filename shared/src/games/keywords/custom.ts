import { hasHan } from '../../han';
import { textLength } from '../../text';
import { cleanClue, wordKey } from './clue';

// The chair's own words for a private room (docs/games/keywords.md#custom-words): pasted one per
// line, or separated by commas or the Chinese enumeration comma. Each is cleaned as a clue is
// (cleanClue), an entry that is the same word as an earlier one (wordKey) or has no letter or
// digit is dropped, and each must fit on a card. Both sides run this: the chair's editor while
// they type, and the server before it keeps the words.

export const MAX_CUSTOM_WORDS = 200;
// What fits on a card: this many Chinese characters, or this many other characters, as a reader
// counts them (words/README.md).
export const CARD_HAN = 5;
export const CARD_LETTERS = 14;
// The longest text that is looked at, in UTF-16 units as it arrives.
export const MAX_CUSTOM_INPUT = 10_000;

const SEPARATOR = /[\n\r,\uff0c\u3001]/;

export const fitsCard = (word: string): boolean => textLength(word) <= (hasHan(word) ? CARD_HAN : CARD_LETTERS);

export interface CustomWords {
  // The words that will do, in the order they were written.
  words: string[];
  // The words that don't fit on a card, which the editor names.
  tooLong: string[];
  // Whether there are more than MAX_CUSTOM_WORDS words in all, which the server refuses.
  tooMany: boolean;
}

export function parseCustomWords(text: string): CustomWords {
  const words: string[] = [];
  const tooLong: string[] = [];
  const keys = new Set<string>();
  // The types promise a string, but the text comes from a player.
  const entries = typeof text === 'string' && text.length <= MAX_CUSTOM_INPUT ? text.split(SEPARATOR) : [];
  for (const entry of entries) {
    const word = cleanClue(entry);
    const key = wordKey(word);
    if (key === '' || keys.has(key)) continue;
    keys.add(key);
    if (fitsCard(word)) words.push(word);
    else tooLong.push(word);
  }
  return { words, tooLong, tooMany: keys.size > MAX_CUSTOM_WORDS };
}
