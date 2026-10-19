import type { Language } from '../../language';
import type { ClueOptions } from './clue';
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

// 'strict' refuses what the word library lists as another form of a word on the board, a Chinese
// character in common with one, and, in a Chinese room, a clue with a word on the board inside
// it; 'loose' only warns about those.
export const CLUE_RULES = ['strict', 'loose'] as const;
export type ClueRule = (typeof CLUE_RULES)[number];

export interface KeywordsSettings {
  guessRule: GuessRule;
  clueRule: ClueRule;
  // How long a clue may be: in a Chinese room, Chinese characters, with two letters or digits
  // counting as one (clueLength() in clue.ts); in an English room, words.
  clueLength: number;
  // The time for the first clue of a game, for every later clue, and for every turn's guesses,
  // in seconds. 0 means no limit.
  firstClueTime: number;
  clueTime: number;
  guessTime: number;
  // Whether each group may once a game add EXTENSION_SECONDS to the phase it is in, where the
  // phase has a time limit (docs/games/keywords.md#extensions).
  extensions: boolean;
}

export const TIME_SETTINGS = ['firstClueTime', 'clueTime', 'guessTime'] as const;

// How much time an extension adds to the current phase.
export const EXTENSION_SECONDS = 30;

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
  firstClueTime: 120,
  clueTime: 90,
  guessTime: 120,
  extensions: false,
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
  if (typeof settings.extensions !== 'boolean') problems.extensions = 'bad_choice';
  return problems;
}

// Settings that a room set up earlier had (RoomSetup), as a room in this language may take them:
// each that still will do, and the default in place of any that won't, such as a clue length
// beyond what the language allows, or that is missing. `from` is the language of the room that
// had them, where it is known: a clue's length is counted in characters in a Chinese room and in
// words in an English one, so one from the other language starts from the default, as the form
// does when the language changes (SettingsForm.vue).
export function restoreSettings(saved: unknown, language: Language, from: Language | null = null): KeywordsSettings {
  const defaults = defaultSettings(language);
  if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) return defaults;
  const kept = { ...defaults } as Record<keyof KeywordsSettings, unknown>;
  for (const key of Object.keys(defaults) as (keyof KeywordsSettings)[]) {
    if (key in saved) kept[key] = (saved as Record<string, unknown>)[key];
  }
  if (from !== null && from !== language) kept.clueLength = defaults.clueLength;
  const settings = kept as unknown as KeywordsSettings;
  for (const key of Object.keys(settingsProblems(settings, language)) as (keyof KeywordsSettings)[]) {
    kept[key] = defaults[key];
  }
  return settings;
}

export const sameSettings = (a: KeywordsSettings, b: KeywordsSettings): boolean =>
  (Object.keys(a) as (keyof KeywordsSettings)[]).every((key) => a[key] === b[key]);

// What the clue check allows in a room with these settings. A Chinese room takes one word, of up
// to the clue length in Chinese characters, two letters or digits counting as one; an English room
// counts the words of a clue instead.
export const clueOptions = (settings: KeywordsSettings, language: Language): ClueOptions =>
  language === 'zh'
    ? { words: 1, length: settings.clueLength, strict: settings.clueRule === 'strict' }
    : { words: settings.clueLength, length: null, strict: settings.clueRule === 'strict' };

// The numbers that may come with a clue. Under the free rule, the number is a hint from 1 to the
// cards that the group still has to find. Under the standard rule, 1 to 9 allow that many guesses
// plus one, and 0 and 'unlimited' allow any number.
export function clueCounts(rule: GuessRule, remaining: number): ClueCount[] {
  if (rule === 'free') return Array.from({ length: remaining }, (_, i) => i + 1);
  return [...Array.from({ length: MAX_CLUE_NUMBER + 1 }, (_, i) => i), 'unlimited'];
}
