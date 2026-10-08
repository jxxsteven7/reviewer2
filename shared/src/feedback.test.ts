import { describe, expect, test } from 'vitest';
import {
  checkContact,
  checkFeedback,
  cleanFeedback,
  MAX_CONTACT_INPUT,
  MAX_CONTACT_LENGTH,
  MAX_FEEDBACK_INPUT,
  MAX_FEEDBACK_LENGTH,
} from './feedback';

// Hidden characters, combining marks and emoji are written as \u escapes, so that they can be
// told apart here. text.test.ts goes through the rules one by one; these tests check what
// feedback makes of them.
const ZERO_WIDTH_SPACE = '\u200b';
const RIGHT_TO_LEFT_OVERRIDE = '\u202e';
const ACUTE = '\u0301';
const ZERO_WIDTH_JOINER = '\u200d';
const FAMILY = `\u{1f468}${ZERO_WIDTH_JOINER}\u{1f469}${ZERO_WIDTH_JOINER}\u{1f467}`;
const HELLO = '\u4f60\u597d'; // "hello" in Chinese
const LINE_SEPARATOR = '\u2028';

describe('feedback', () => {
  test('is kept as it was typed, line breaks included', () => {
    expect(checkFeedback('The timer is too short.')).toEqual({ text: 'The timer is too short.', problem: null });
    expect(cleanFeedback('1. Open a room\n2. Lock the phone\r\n3. Come back')).toBe(
      '1. Open a room\n2. Lock the phone\n3. Come back',
    );
    expect(cleanFeedback(`${HELLO}\r${HELLO}`)).toBe(`${HELLO}\n${HELLO}`);
  });

  test('cleans each line as a chat message is cleaned', () => {
    expect(cleanFeedback('  two\t\tspaces   here  \n  and there ')).toBe('two spaces here\nand there');
    expect(cleanFeedback(`a${ZERO_WIDTH_SPACE}b ${RIGHT_TO_LEFT_OVERRIDE}c`)).toBe('ab c');
    expect(cleanFeedback(`e${ACUTE.repeat(9)}`)).toBe(`e${ACUTE.repeat(4)}`);
    expect(cleanFeedback(`${ACUTE}stray\n${ACUTE}mark`)).toBe('stray\nmark');
    expect(cleanFeedback(`${FAMILY} ok`)).toBe(`${FAMILY} ok`);
    // A line separator is a space, like any other whitespace inside a line.
    expect(cleanFeedback(`one${LINE_SEPARATOR}line`)).toBe('one line');
  });

  test('drops blank lines at its ends and keeps one of a run', () => {
    expect(cleanFeedback('\n\n  \nfirst\n\n\n\n \nsecond\n\n')).toBe('first\n\nsecond');
    expect(cleanFeedback(`first\n${ZERO_WIDTH_SPACE}\n\nsecond`)).toBe('first\n\nsecond');
  });

  test('is refused when it shows nothing', () => {
    for (const text of ['', '   ', '\n\n\n', ZERO_WIDTH_SPACE, `${ZERO_WIDTH_JOINER}\n${ACUTE}`]) {
      expect(checkFeedback(text), JSON.stringify(text)).toEqual({ text: '', problem: 'feedback_empty' });
    }
  });

  test('is 1000 characters at most, counted as a reader sees them', () => {
    expect(checkFeedback('x'.repeat(MAX_FEEDBACK_LENGTH)).problem).toBeNull();
    expect(checkFeedback(FAMILY.repeat(MAX_FEEDBACK_LENGTH / 2)).problem).toBeNull();
    expect(checkFeedback('x'.repeat(MAX_FEEDBACK_LENGTH + 1)).problem).toBe('feedback_too_long');
    // A line break counts as a character.
    expect(checkFeedback(`${'x'.repeat(MAX_FEEDBACK_LENGTH - 1)}\ny`).problem).toBe('feedback_too_long');
    // What is cleaned away doesn't count.
    expect(checkFeedback(`${' '.repeat(500)}${'x'.repeat(MAX_FEEDBACK_LENGTH)}${' '.repeat(500)}`).problem).toBeNull();
  });

  test('is not looked at when it arrives longer than anything that could be kept', () => {
    expect(checkFeedback(' '.repeat(MAX_FEEDBACK_INPUT + 1))).toEqual({ text: '', problem: 'feedback_too_long' });
  });

  test('that is not text is empty', () => {
    expect(checkFeedback(42 as unknown as string)).toEqual({ text: '', problem: 'feedback_empty' });
  });
});

describe('the contact', () => {
  test('is optional, and one that shows nothing is none', () => {
    for (const text of [undefined, '', '  ', ZERO_WIDTH_SPACE, '\n']) {
      expect(checkContact(text), JSON.stringify(text)).toEqual({ contact: null, problem: null });
    }
  });

  test('is one line, cleaned as a chat message is', () => {
    expect(checkContact('  wechat:\treviewer_2\n ')).toEqual({ contact: 'wechat: reviewer_2', problem: null });
    expect(checkContact(`me${ZERO_WIDTH_SPACE}@example.com`)).toEqual({ contact: 'me@example.com', problem: null });
  });

  test('is 100 characters at most', () => {
    expect(checkContact('x'.repeat(MAX_CONTACT_LENGTH)).problem).toBeNull();
    expect(checkContact('x'.repeat(MAX_CONTACT_LENGTH + 1))).toEqual({
      contact: 'x'.repeat(MAX_CONTACT_LENGTH + 1),
      problem: 'contact_too_long',
    });
    expect(checkContact(' '.repeat(MAX_CONTACT_INPUT + 1))).toEqual({ contact: null, problem: 'contact_too_long' });
  });

  test('that is not text is none', () => {
    expect(checkContact(7 as unknown as string)).toEqual({ contact: null, problem: null });
  });
});
