import { defaultSettings, type Language } from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import { PERSONAS } from './personas';
import { clueSystem, PROMPT_VERSION } from './prompts';
import { clueRequest } from './testing';

// What the PI is told in a room of the language and the clue length given.
const clueRules = (language: Language, clueLength: number) =>
  clueSystem(clueRequest({ language, settings: { ...defaultSettings(language), clueLength } }), PERSONAS.reviewer1);

const ONE_CHARACTER = /single Chinese character/i;
const NOT_A_WORD = /need not be a dictionary word/i;
const ONE_SINGLE = /at least one of the three candidates must be a single character/i;
const BEST_FIRST = /put the best candidate first/i;

describe('the clue rules', () => {
  test('in a Chinese room, let a clue be one character, or a few that need not be a word', () => {
    const rules = clueRules('zh', 4);
    expect(rules).toMatch(ONE_CHARACTER);
    expect(rules).toMatch(NOT_A_WORD);
    expect(rules).toMatch(/at most 4 Chinese characters/);
    // The rules against the board's words stay as they were.
    expect(rules).toMatch(/share any Chinese character with one/);
    expect(rules).toMatch(/must not be the English term or the pinyin of a word on the board/);
  });

  test('in a Chinese room that takes more than one character, ask for one candidate of a single character, the best first', () => {
    for (const clueLength of [2, 4, 10]) {
      const rules = clueRules('zh', clueLength);
      expect(rules).toMatch(ONE_SINGLE);
      expect(rules).toMatch(BEST_FIRST);
    }
  });

  test('in a Chinese room of one character, ask for one character and nothing about the others', () => {
    const rules = clueRules('zh', 1);
    expect(rules).toMatch(ONE_CHARACTER);
    expect(rules).toMatch(BEST_FIRST);
    expect(rules).not.toMatch(ONE_SINGLE);
    expect(rules).not.toMatch(NOT_A_WORD);
    expect(rules).not.toMatch(/at most 1 /);
  });

  test('in an English room, stay as they were', () => {
    for (const clueLength of [1, 3]) {
      const rules = clueRules('en', clueLength);
      for (const phrase of [ONE_CHARACTER, NOT_A_WORD, ONE_SINGLE, BEST_FIRST, /dictionary/i, /character/i]) {
        expect(rules).not.toMatch(phrase);
      }
    }
    expect(clueRules('en', 1)).toMatch(/the clue is exactly one English word/);
    expect(clueRules('en', 3)).toMatch(/the clue is at most 3 English words/);
  });

  test('are noted with a new version of the prompts', () => {
    expect(PROMPT_VERSION).toBe('keywords-3');
  });
});
