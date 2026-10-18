import { defaultSettings, type Language } from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import { PERSONAS } from './personas';
import { clueSystem, clueUser, PROMPT_VERSION } from './prompts';
import { clueRequest } from './testing';

// What the PI is told in a room of the language and the clue length given.
const clueRules = (language: Language, clueLength: number) =>
  clueSystem(clueRequest({ language, settings: { ...defaultSettings(language), clueLength } }), PERSONAS.reviewer1);

const AIM =
  /The aim: give one clue and a number so that they reveal as many of OUR cards as they can and stay away from REVIEWER 2 and THEIR cards\./;
const ONLY_SURE =
  /Count only the cards that they can surely work out from the clue: never stretch a clue to more cards than they can follow\./;
const ONE_CHARACTER = /as a single Chinese character/i;
const ANY_WAY =
  /How the clue is written is up to you, as a means to the aim: a single character; a few single characters that need not form a word, written together with no spaces, none of them taken from the board, each tying cards together through its own meanings; a word or a phrase/;
const WORD_AND_CHARACTERS = /; or a word with a single character or two beside it\./;
const BY_THE_AIM = /whichever way lets your students link the most of OUR cards without going wrong/;
const ONE_SINGLE = /at least one of the three candidates must be a single character/i;
const SINGLE_BEST = /a single character is often the best/i;
const BEST_FIRST = /put the best (candidate )?first/i;

describe('the clue rules', () => {
  test("say that the aim is the most of the group's cards that its students can work out, safely", () => {
    for (const [language, clueLength] of [
      ['zh', 1],
      ['zh', 2],
      ['zh', 4],
      ['en', 1],
      ['en', 3],
    ] as const) {
      const rules = clueRules(language, clueLength);
      expect(rules).toMatch(AIM);
      expect(rules).toMatch(ONLY_SURE);
      // Nothing says that a clue is one word, which the clue rules may allow it not to be.
      expect(rules).toMatch(/The clue is new, not on the board, and links the cards you aim at\./);
      expect(rules).not.toMatch(/new word/);
    }
  });

  test('in a Chinese room that takes more than one character, let the clue be written in any way, one candidate long', () => {
    for (const [clueLength, long] of [
      [2, 2],
      [3, 3],
      [4, 4],
      [10, 4],
    ] as const) {
      const rules = clueRules('zh', clueLength);
      expect(rules).toMatch(new RegExp(`at most ${clueLength} Chinese characters`));
      expect(rules).toMatch(ANY_WAY);
      expect(rules).toMatch(BY_THE_AIM);
      expect(rules).toMatch(
        new RegExp(
          `Write the three candidates in three different ways, and make one of them ${long} characters long\\. Rank them by the aim`,
        ),
      );
      expect(rules).toMatch(BEST_FIRST);
      // A word with characters beside it takes three characters at least.
      if (clueLength >= 3) expect(rules).toMatch(WORD_AND_CHARACTERS);
      else expect(rules).not.toMatch(WORD_AND_CHARACTERS);
      // Nothing favors single characters any more.
      expect(rules).not.toMatch(ONE_SINGLE);
      expect(rules).not.toMatch(SINGLE_BEST);
      // The rules against the board's words stay as they were.
      expect(rules).toMatch(/share any Chinese character with one/);
      expect(rules).toMatch(/must not be the English term or the pinyin of a word on the board/);
    }
  });

  test('in a Chinese room of one character, ask for one character and nothing else', () => {
    const rules = clueRules('zh', 1);
    expect(rules).toMatch(ONE_CHARACTER);
    expect(rules).toMatch(BEST_FIRST);
    expect(rules).toMatch(/share any Chinese character with one/);
    for (const phrase of [
      ANY_WAY,
      WORD_AND_CHARACTERS,
      BY_THE_AIM,
      ONE_SINGLE,
      /a few single characters/,
      /three different ways/,
    ]) {
      expect(rules).not.toMatch(phrase);
    }
    expect(rules).not.toMatch(/at most 1 /);
  });

  test('in an English room, let a clue be written in any way the room allows, by the aim', () => {
    for (const clueLength of [1, 3]) {
      const rules = clueRules('en', clueLength);
      for (const phrase of [ONE_CHARACTER, ANY_WAY, ONE_SINGLE, /dictionary/i, /character/i, /three different ways/]) {
        expect(rules).not.toMatch(phrase);
      }
    }
    const one = clueRules('en', 1);
    expect(one).toMatch(/the clue is exactly one English word\./);
    expect(one).not.toMatch(BY_THE_AIM);
    expect(clueRules('en', 3)).toMatch(
      /the clue is at most 3 English words, in whichever way lets your students link the most of OUR cards without going wrong\./,
    );
  });

  test('after refused clues in a Chinese room, remind the model of what went wrong: spaces, or the board', () => {
    const chinese = clueRequest({ language: 'zh', settings: defaultSettings('zh') });
    const spaced = { word: '光 电', problem: 'clue_not_one_word', why: 'it is not one word' };
    const onBoard = { word: '电磁', problem: 'clue_on_board', why: 'it shares or names a character of card 2 (电场)' };
    const given = { word: '光', problem: 'clue_given', why: 'it was given before' };
    const SPACES = /Write each clue with no spaces\./;
    const BOARD = /Check every character of each clue: none may appear in a word on the board that is not revealed\./;
    expect(clueUser(chinese, [spaced])).toMatch(SPACES);
    expect(clueUser(chinese, [spaced])).not.toMatch(BOARD);
    expect(clueUser(chinese, [onBoard])).toMatch(BOARD);
    expect(clueUser(chinese, [onBoard])).not.toMatch(SPACES);
    expect(clueUser(chinese, [spaced, onBoard])).toMatch(
      /Write each clue with no spaces\. Check every character of each clue: none may appear in a word on the board that is not revealed\./,
    );
    // A clue refused for another reason, or none, brings no reminder, nor does an English room.
    for (const user of [clueUser(chinese, [given]), clueUser(chinese), clueUser(clueRequest(), [spaced, onBoard])]) {
      expect(user).not.toMatch(SPACES);
      expect(user).not.toMatch(BOARD);
    }
  });

  test('are noted with a new version of the prompts', () => {
    expect(PROMPT_VERSION).toBe('keywords-4');
  });
});
