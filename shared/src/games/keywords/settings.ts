import type { Language } from '../../language';
import { MAX_CLUE_HAN, type ClueOptions } from './clue';
import { MAX_CLUE_NUMBER, type ClueCount } from './types';

// The settings of a room of the team word guessing game (docs/games/keywords.md). The chair
// chooses them when creating the room and may change them in the waiting room; a game plays with
// the settings that the room had when it started. The room setup and the server check them with
// the same function, settingsProblems().

// 'free': guessers go on for as long as they find their own cards, and the number of a clue is
// only a hint, from 1 to the cards the group has left. 'standard': a clue allows its number plus
// one guesses, and 0 and 'unlimited' allow any number.
export const GUESS_RULES = ['free', 'standard'] as const;
export type GuessRule = (typeof GUESS_RULES)[number];

// 'strict' refuses what the word library lists as another form of a word on the board, and a
// Chinese character in common with one; 'loose' only warns about those.
export const CLUE_RULES = ['strict', 'loose'] as const;
export type ClueRule = (typeof CLUE_RULES)[number];

export interface KeywordsSettings {
  guessRule: GuessRule;
  clueRule: ClueRule;
  // How long a clue may be: Chinese characters in a Chinese room, words in an English room.
  clueLength: number;
  // The time for the first clue of a game, for every later clue, and for every turn's guesses,
  // in seconds. 0 means no limit.
  firstClueTime: number;
  clueTime: number;
  guessTime: number;
}

export const TIME_SETTINGS = ['firstClueTime', 'clueTime', 'guessTime'] as const;

// The clue length that a room may choose, and the one it starts with, by the room's language.
export const CLUE_LENGTH: Record<Language, { min: number; max: number; default: number }> = {
  zh: { min: 1, max: 10, default: 4 },
  en: { min: 1, max: 3, default: 1 },
};

// A time limit is 0, for none, or a number of seconds in this range.
export const TIME_LIMIT = { min: 10, max: 600 } as const;

export const defaultSettings = (language: Language): KeywordsSettings => ({
  guessRule: 'free',
  clueRule: 'strict',
  clueLength: CLUE_LENGTH[language].default,
  firstClueTime: 90,
  clueTime: 60,
  guessTime: 90,
});

// What is wrong with one setting: it isn't one of the choices, it isn't a whole number, or it is
// outside the range for the room's language.
export type SettingProblem = 'bad_choice' | 'not_whole' | 'out_of_range';

const isWhole = (value: unknown): value is number => Number.isInteger(value);

// What is wrong with each setting, if anything. An empty object means that the settings will do.
export function settingsProblems(
  settings: KeywordsSettings,
  language: Language,
): Partial<Record<keyof KeywordsSettings, SettingProblem>> {
  const problems: Partial<Record<keyof KeywordsSettings, SettingProblem>> = {};
  if (!GUESS_RULES.includes(settings.guessRule)) problems.guessRule = 'bad_choice';
  if (!CLUE_RULES.includes(settings.clueRule)) problems.clueRule = 'bad_choice';
  const length = CLUE_LENGTH[language];
  if (!isWhole(settings.clueLength)) problems.clueLength = 'not_whole';
  else if (settings.clueLength < length.min || settings.clueLength > length.max) problems.clueLength = 'out_of_range';
  for (const key of TIME_SETTINGS) {
    const seconds = settings[key];
    if (!isWhole(seconds)) problems[key] = 'not_whole';
    else if (seconds !== 0 && (seconds < TIME_LIMIT.min || seconds > TIME_LIMIT.max)) problems[key] = 'out_of_range';
  }
  return problems;
}

export const sameSettings = (a: KeywordsSettings, b: KeywordsSettings): boolean =>
  (Object.keys(a) as (keyof KeywordsSettings)[]).every((key) => a[key] === b[key]);

// What the clue check allows in a room with these settings. A Chinese room counts the Chinese
// characters of a clue and takes one word; an English room counts its words.
export const clueOptions = (settings: KeywordsSettings, language: Language): ClueOptions =>
  language === 'zh'
    ? { words: 1, han: settings.clueLength, strict: settings.clueRule === 'strict' }
    : { words: settings.clueLength, han: MAX_CLUE_HAN, strict: settings.clueRule === 'strict' };

// The numbers that may come with a clue. Under the free rule, the number is a hint from 1 to the
// cards that the group still has to find. Under the standard rule, 1 to 9 allow that many guesses
// plus one, and 0 and 'unlimited' allow any number.
export function clueCounts(rule: GuessRule, remaining: number): ClueCount[] {
  if (rule === 'free') return Array.from({ length: remaining }, (_, i) => i + 1);
  return [...Array.from({ length: MAX_CLUE_NUMBER + 1 }, (_, i) => i), 'unlimited'];
}
