// What players write in a game of the hidden word game (docs/games/impostor.md#describing): a
// description of their word, the reason for a report, a guess of the students' word and a line of
// the off-field chat. The client runs these checks while a player types, and the server runs them
// again before it takes what was written.

import { checkChat, type ChatProblem } from '../../chat';
import { fitsCard } from '../../custom';
import { HAN } from '../../han';
import { cleanLine, showsSomething, textLength } from '../../text';
import { foldWord, wordKey, type BoardWord } from '../../words';
import { MAX_LINE_INPUT, MAX_REASON_LENGTH } from './types';

export type LineProblem = 'line_empty' | 'line_too_long' | 'line_has_word' | 'line_repeated';

export interface LineCheck {
  // The line as it is kept and shown.
  text: string;
  problem: LineProblem | null;
  // What of the writer's word the line gives away, as the word has it: a Chinese character, a
  // word, a form, a translation or a syllable of the pinyin.
  match: string | null;
}

const LATIN_ONLY = /^\p{Script=Latin}+$/u;
const LATIN_RUN = /[\p{Script=Latin}\p{N}]+/gu;
const HAN_RUN = /\p{Script=Han}+/gu;
// Small words don't count on their own as a part of a word: "of" gives no word away.
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
// Syllables of pinyin that count on their own, as in the first game's clue check: those of three
// letters or more.
const SYLLABLE_LENGTH = 3;

// A plain plural: -s, or -es after s, x, z, ch or sh.
const isPluralOf = (plural: string, word: string) =>
  plural === `${word}s` || (/(?:[sxz]|[cs]h)$/.test(word) && plural === `${word}es`);
const sameOrPlural = (a: string, b: string) => a === b || isPluralOf(a, b) || isPluralOf(b, a);

// The Latin words of a text, folded, which a line is held against one by one.
const latinWords = (text: string): string[] =>
  (foldWord(text).match(LATIN_RUN) ?? []).filter((word) => /\p{L}/u.test(word));

// What of a word a line may not repeat, each with the text that a refusal names: every Chinese
// character of the word itself; the word, its forms and its translations, each whole, as a run of
// Chinese characters or as its Latin words in a row, and each Latin word of them that isn't a
// small one; and the pinyin of a Chinese word, solid or by its syllables.
function giveaways(word: BoardWord): { han: Map<string, string>; runs: string[][]; latin: Set<string> } {
  const han = new Map<string, string>();
  for (const char of word.word) {
    const folded = foldWord(char);
    if (HAN.test(char) && !han.has(folded)) han.set(folded, char);
  }
  const runs: string[][] = [];
  const latin = new Set<string>();
  for (const text of [word.word, ...(word.forms ?? []), ...(word.translations ?? [])]) {
    for (const run of foldWord(text).match(HAN_RUN) ?? []) runs.push([run]);
    const words = latinWords(text);
    if (words.length > 0) runs.push(words);
    for (const part of words) if (part.length > 1 && !SMALL_WORDS.has(part)) latin.add(part);
  }
  if (word.pinyin !== undefined) {
    for (const pinyin of [word.pinyin, word.pinyin.replace(/\u00fc/g, 'v')]) {
      latin.add(wordKey(pinyin));
      for (const syllable of pinyin.split(' ')) {
        const key = wordKey(syllable);
        if (key.length >= SYLLABLE_LENGTH && LATIN_ONLY.test(key)) latin.add(key);
      }
    }
  }
  return { han, runs, latin };
}

// The first thing of the word that the text gives away, as the word has it, or null for none:
// a Chinese character of the word, a Latin word of it, its form or its translation, or its
// pinyin. Exported for the agent, which holds its own lines against it before it gives one.
export function givesAway(text: string, word: BoardWord): string | null {
  const folded = foldWord(text);
  const found = giveaways(word);
  for (const char of folded) {
    const original = found.han.get(char);
    if (original !== undefined) return original;
  }
  const words = latinWords(text);
  for (const run of found.runs) {
    if (run.length === 1 && HAN.test(run[0] as string) && folded.replace(/\s+/g, '').includes(run[0] as string)) {
      return run[0] as string;
    }
  }
  for (const part of words) {
    for (const given of found.latin) if (sameOrPlural(part, given)) return given;
  }
  // A word of several Latin words, written in a row, or solid.
  const solid = wordKey(text);
  for (const run of found.runs) {
    if (run.length < 2) continue;
    const joined = run.join('');
    if (joined.length >= 4 && solid.includes(joined)) return run.join(' ');
  }
  return null;
}

// How far apart two texts are, in the characters to add, take away or change, but no further
// than `limit` + 1, past which the count stops.
function distance(a: readonly string[], b: readonly string[], limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1,
        (previous[j - 1] as number) + cost,
      );
      current.push(value);
      best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length] as number;
}

// One character in eight may differ for two lines to be all but the same, counting only their
// letters and digits: two lines of up to 7 must be the same, two of 16 may differ in two.
const SAME_SHARE = 8;

// Whether a line is all but the same as one written before it in the game.
export function repeatsLine(text: string, earlier: readonly string[]): boolean {
  const key = [...wordKey(text)];
  if (key.length === 0) return false;
  return earlier.some((line) => {
    const other = [...wordKey(line)];
    const limit = Math.floor(Math.max(key.length, other.length) / SAME_SHARE);
    return distance(key, other, limit) <= limit;
  });
}

// Cleans a line and checks its length, the first part of every check here.
function measured(text: string, max: number): LineCheck {
  // The types promise a string, but the line comes from a player.
  if (typeof text !== 'string' || text.length > MAX_LINE_INPUT) {
    return { text: '', problem: typeof text === 'string' ? 'line_too_long' : 'line_empty', match: null };
  }
  const cleaned = cleanLine(text);
  if (!showsSomething(cleaned)) return { text: '', problem: 'line_empty', match: null };
  if (textLength(cleaned) > max) return { text: cleaned, problem: 'line_too_long', match: null };
  return { text: cleaned, problem: null, match: null };
}

// A description of the writer's word, or of none for the PI: no longer than the room allows, giving
// nothing of the word away, and not all but the same as a line before it in the game.
export function checkDescription(
  text: string,
  word: BoardWord | null,
  earlier: readonly string[],
  length: number,
): LineCheck {
  const check = measured(text, length);
  if (check.problem) return check;
  const match = word && givesAway(check.text, word);
  if (match) return { text: check.text, problem: 'line_has_word', match };
  if (repeatsLine(check.text, earlier)) return { text: check.text, problem: 'line_repeated', match: null };
  return check;
}

// The reason for a report: up to MAX_REASON_LENGTH characters, giving nothing of the reporter's
// word away.
export function checkReason(text: string, word: BoardWord | null): LineCheck {
  const check = measured(text, MAX_REASON_LENGTH);
  if (check.problem) return check;
  const match = word && givesAway(check.text, word);
  return match ? { text: check.text, problem: 'line_has_word', match } : check;
}

// Whether a guess of the students' word is that word: the word itself or a plain plural of it,
// one of its forms, or its term in another language, letters and digits alone counting.
export function guessesWord(guess: string, word: BoardWord): boolean {
  if (typeof guess !== 'string' || guess.length > MAX_LINE_INPUT) return false;
  const key = wordKey(guess);
  if (key === '') return false;
  return [word.word, ...(word.forms ?? []), ...(word.translations ?? [])].some((text) =>
    sameOrPlural(key, wordKey(text)),
  );
}

export type TalkProblem = ChatProblem | 'chat_has_word';

// A line of the off-field chat (docs/games/impostor.md#off-field): a line of chat that names
// neither word of the game, or its forms or translations, whole.
export function checkTalk(text: string, words: readonly BoardWord[]): { text: string; problem: TalkProblem | null } {
  const check = checkChat(text);
  if (check.problem) return check;
  const folded = foldWord(check.text).replace(/\s+/g, '');
  const latin = ` ${latinWords(check.text).join(' ')} `;
  for (const word of words) {
    for (const given of [word.word, ...(word.forms ?? []), ...(word.translations ?? [])]) {
      const han = foldWord(given).replace(/\s+/g, '');
      if (HAN.test(given) && folded.includes(han)) return { text: check.text, problem: 'chat_has_word' };
      const parts = latinWords(given);
      if (parts.length === 0 || HAN.test(given)) continue;
      const whole = parts.join(' ');
      if (latin.includes(` ${whole} `) || latin.includes(` ${whole}s `) || latin.includes(` ${whole}es `)) {
        return { text: check.text, problem: 'chat_has_word' };
      }
    }
  }
  return check;
}

export type SetterProblem = 'words_missing' | 'words_too_long' | 'words_same';

// The setter's two words (docs/games/impostor.md#the-setter): both there, each short enough for the
// word library, and different, not even forms of each other. The words are checked whole, as they
// are kept (cleanLine); the schema of the message bounds what arrives (MAX_LINE_INPUT).
export function checkSetterWords(a: string, b: string): SetterProblem | null {
  const first = cleanLine(typeof a === 'string' ? a : '');
  const second = cleanLine(typeof b === 'string' ? b : '');
  if (wordKey(first) === '' || wordKey(second) === '') return 'words_missing';
  if (!fitsCard(first) || !fitsCard(second)) return 'words_too_long';
  if (sameOrPlural(wordKey(first), wordKey(second))) return 'words_same';
  return null;
}

// Whether two pairs of terms are the same pair, in either order (docs/games/impostor.md#matches):
// each term of one is a term of the other, counting only letters and digits, plain plurals
// included, as checkSetterWords() tells two terms apart.
export function samePair(first: readonly [string, string], second: readonly [string, string]): boolean {
  const same = (a: string, b: string) => sameOrPlural(wordKey(cleanLine(a)), wordKey(cleanLine(b)));
  const [a, b] = first;
  const [c, d] = second;
  return (same(a, c) && same(b, d)) || (same(a, d) && same(b, c));
}
