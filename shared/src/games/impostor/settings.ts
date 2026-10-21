import type { Language } from '../../language';

// The settings of a room of the hidden word game (docs/games/impostor.md). The chair chooses them
// when creating the room and may change them in the waiting room; a game plays with the settings
// that the room had when it started. The room setup and the server check them with the same
// function, settingsProblems().
export interface ImpostorSettings {
  // The time for each description and for each vote, in seconds. 0 means no limit, for a game
  // played around one table.
  describeTime: number;
  voteTime: number;
  // How long a description may be, in the characters that a reader sees (textLength in text.ts).
  length: number;
  // Whether a game of 6 or more has a PI, who gets no word (roleCounts in rules.ts).
  pi: boolean;
  // Whether a Reviewer 2 or a PI who is voted out may guess the students' word once.
  comeback: boolean;
  // Whether the players are shown by their numbers alone until the game ends.
  anonymous: boolean;
  // Whether those who only watch see every role and both words. A private room only.
  godView: boolean;
  // Whether the chair sets the two words instead of the word library: the setter, who watches
  // (docs/games/impostor.md#the-setter). A private room only, and the chair needs an account.
  setter: boolean;
}

export const TIME_SETTINGS = ['describeTime', 'voteTime'] as const;

// A time limit is 0, for none, or a number of seconds in this range.
export const TIME_LIMIT = { min: 10, max: 600 } as const;

// The length of a description that a room may choose, and the one it starts with, by the room's
// language.
export const DESCRIPTION_LENGTH: Record<Language, { min: number; max: number; default: number }> = {
  zh: { min: 5, max: 50, default: 20 },
  en: { min: 20, max: 150, default: 60 },
};

export const defaultSettings = (language: Language): ImpostorSettings => ({
  describeTime: 60,
  voteTime: 30,
  length: DESCRIPTION_LENGTH[language].default,
  pi: true,
  comeback: false,
  anonymous: true,
  godView: false,
  setter: false,
});

// The settings that only a private room may have.
export const PRIVATE_SETTINGS = ['godView', 'setter'] as const;

// What is wrong with one setting: it isn't one of the choices, it isn't a whole number, or it is
// outside the range for the room's language.
export type SettingProblem = 'bad_choice' | 'not_whole' | 'out_of_range';

const isWhole = (value: unknown): value is number => Number.isInteger(value);
const FLAGS = ['pi', 'comeback', 'anonymous', 'godView', 'setter'] as const;

// What is wrong with each setting, if anything. An empty object means that the settings will do.
export function settingsProblems(
  settings: ImpostorSettings,
  language: Language,
): Partial<Record<keyof ImpostorSettings, SettingProblem>> {
  const problems: Partial<Record<keyof ImpostorSettings, SettingProblem>> = {};
  for (const key of TIME_SETTINGS) {
    const seconds = settings[key];
    if (!isWhole(seconds)) problems[key] = 'not_whole';
    else if (seconds !== 0 && (seconds < TIME_LIMIT.min || seconds > TIME_LIMIT.max)) problems[key] = 'out_of_range';
  }
  const length = DESCRIPTION_LENGTH[language];
  if (!isWhole(settings.length)) problems.length = 'not_whole';
  else if (settings.length < length.min || settings.length > length.max) problems.length = 'out_of_range';
  for (const key of FLAGS) if (typeof settings[key] !== 'boolean') problems[key] = 'bad_choice';
  return problems;
}

// Settings that a room set up earlier had (RoomSetup), as a room in this language may take them:
// each that still will do, and the default in place of any that won't, or that is missing. A
// description's length is counted alike in both languages, but the ranges differ, so one from a
// room in the other language starts from the default.
export function restoreSettings(saved: unknown, language: Language, from: Language | null = null): ImpostorSettings {
  const defaults = defaultSettings(language);
  if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) return defaults;
  const kept = { ...defaults } as Record<keyof ImpostorSettings, unknown>;
  for (const key of Object.keys(defaults) as (keyof ImpostorSettings)[]) {
    if (key in saved) kept[key] = (saved as Record<string, unknown>)[key];
  }
  if (from !== null && from !== language) kept.length = defaults.length;
  const settings = kept as unknown as ImpostorSettings;
  for (const key of Object.keys(settingsProblems(settings, language)) as (keyof ImpostorSettings)[]) {
    kept[key] = defaults[key];
  }
  return settings;
}

export const sameSettings = (a: ImpostorSettings, b: ImpostorSettings): boolean =>
  (Object.keys(a) as (keyof ImpostorSettings)[]).every((key) => a[key] === b[key]);

// Whether a room with these settings may be listed for anyone to join.
export const mayBePublic = (settings: ImpostorSettings): boolean => PRIVATE_SETTINGS.every((key) => !settings[key]);
