import { hasHan } from '@reviewer2/shared';
import { pinyin } from 'pinyin-pro';

// The pinyin of a word with Chinese characters in it, for the clue check (shared/src/games/
// keywords/clue.ts): without tones, with a space between the syllables, with "ü" as it is, and
// with whatever isn't Chinese, such as "GPU", left as it is. The library, pinyin-pro, reads
// polyphones by the word, so that the pinyin is the one a reader would say. Null for a word
// without Chinese characters, which has none.
export function pinyinOf(word: string): string | null {
  if (!hasHan(word)) return null;
  return pinyin(word, { toneType: 'none', nonZh: 'consecutive' }).replace(/\s+/g, ' ').trim();
}
