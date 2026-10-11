import { describe, expect, test } from 'vitest';
import {
  clueCounts,
  clueOptions,
  defaultSettings,
  sameSettings,
  settingsProblems,
  type KeywordsSettings,
} from './settings';

describe('the settings of a room', () => {
  test('start with the free and strict rules, one word or four characters, and 90, 60 and 90 seconds', () => {
    expect(defaultSettings('en')).toEqual({
      guessRule: 'free',
      clueRule: 'strict',
      clueLength: 1,
      firstClueTime: 90,
      clueTime: 60,
      guessTime: 90,
      extensions: false,
    });
    expect(defaultSettings('zh').clueLength).toBe(4);
    expect(settingsProblems(defaultSettings('en'), 'en')).toEqual({});
    expect(settingsProblems(defaultSettings('zh'), 'zh')).toEqual({});
  });

  test('take a clue length that suits the language of the room', () => {
    const length = (clueLength: number, language: 'zh' | 'en') =>
      settingsProblems({ ...defaultSettings(language), clueLength }, language).clueLength;
    expect(length(1, 'zh')).toBeUndefined();
    expect(length(10, 'zh')).toBeUndefined();
    expect(length(11, 'zh')).toBe('out_of_range');
    expect(length(0, 'zh')).toBe('out_of_range');
    expect(length(3, 'en')).toBeUndefined();
    expect(length(4, 'en')).toBe('out_of_range');
    expect(length(2.5, 'en')).toBe('not_whole');
    expect(length(Number.NaN, 'en')).toBe('not_whole');
  });

  test('take times of 0, for no limit, or 10 to 600 seconds', () => {
    const times = (seconds: number) =>
      settingsProblems(
        { ...defaultSettings('en'), firstClueTime: seconds, clueTime: seconds, guessTime: seconds },
        'en',
      );
    for (const seconds of [0, 10, 600]) expect(times(seconds), String(seconds)).toEqual({});
    for (const seconds of [-1, 1, 9, 601]) {
      expect(times(seconds), String(seconds)).toEqual({
        firstClueTime: 'out_of_range',
        clueTime: 'out_of_range',
        guessTime: 'out_of_range',
      });
    }
    expect(times(30.5).clueTime).toBe('not_whole');
    expect(times(Number.POSITIVE_INFINITY).guessTime).toBe('not_whole');
  });

  test('take only the rules that there are', () => {
    const odd = { ...defaultSettings('en'), guessRule: 'fast', clueRule: 'none' } as unknown as KeywordsSettings;
    expect(settingsProblems(odd, 'en')).toEqual({ guessRule: 'bad_choice', clueRule: 'bad_choice' });
  });

  test('are the same when every setting is', () => {
    expect(sameSettings(defaultSettings('en'), defaultSettings('en'))).toBe(true);
    expect(sameSettings(defaultSettings('en'), { ...defaultSettings('en'), guessTime: 0 })).toBe(false);
  });
});

describe('what the settings allow', () => {
  test('a Chinese room counts the characters of a clue, and an English room its words', () => {
    const settings = { ...defaultSettings('en'), clueLength: 3, clueRule: 'loose' as const };
    expect(clueOptions(settings, 'zh')).toEqual({ words: 1, length: 3, strict: false });
    expect(clueOptions(settings, 'en')).toEqual({ words: 3, length: null, strict: false });
    expect(clueOptions(defaultSettings('en'), 'en').strict).toBe(true);
  });

  test('the free rule takes numbers from 1 to the cards left, the standard rule 0 to 9 and unlimited', () => {
    expect(clueCounts('free', 3)).toEqual([1, 2, 3]);
    expect(clueCounts('free', 1)).toEqual([1]);
    expect(clueCounts('standard', 3)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 'unlimited']);
  });
});
