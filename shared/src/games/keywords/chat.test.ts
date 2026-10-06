import { describe, expect, test } from 'vitest';
import { checkChat, cleanChat, MAX_CHAT_INPUT, MAX_CHAT_LENGTH } from './chat';

// Invisible characters, combining marks and emoji are written as \u escapes, so that they can be
// told apart here.
const ZERO_WIDTH_SPACE = '\u200b';
const RIGHT_TO_LEFT_OVERRIDE = '\u202e';
const SOFT_HYPHEN = '\u00ad';
const ACUTE = '\u0301';
const ZERO_WIDTH_JOINER = '\u200d';
const EMOJI_SELECTOR = '\ufe0f';
const HEART = `\u2764${EMOJI_SELECTOR}`;
const FAMILY = `\u{1f468}${ZERO_WIDTH_JOINER}\u{1f469}${ZERO_WIDTH_JOINER}\u{1f467}`;
const HELLO = '\u4f60\u597d'; // "hello" in Chinese

describe('a chat message', () => {
  test('is kept as it was typed, on one line', () => {
    expect(checkChat('Card 3, I think.')).toEqual({ text: 'Card 3, I think.', problem: null });
    expect(cleanChat('  two\n\nlines\tand   spaces ')).toBe('two lines and spaces');
    expect(cleanChat(`${HELLO}\uff01 R\u00b2`)).toBe(`${HELLO}\uff01 R\u00b2`);
    expect(cleanChat('bell\u0007and\u0000null')).toBe('bell and null');
  });

  test('loses invisible characters, but keeps emoji whole', () => {
    expect(cleanChat(`a${ZERO_WIDTH_SPACE}b${SOFT_HYPHEN}c`)).toBe('abc');
    expect(cleanChat(`${RIGHT_TO_LEFT_OVERRIDE}abc`)).toBe('abc');
    expect(cleanChat(`${HEART} ${FAMILY}`)).toBe(`${HEART} ${FAMILY}`);
  });

  test('keeps accents, but no pile of them', () => {
    expect(cleanChat(`cafe${ACUTE}`)).toBe(`cafe${ACUTE}`);
    expect(cleanChat(`e${ACUTE.repeat(40)}!`)).toBe(`e${ACUTE.repeat(2)}!`);
  });

  test('must show something', () => {
    for (const text of [
      '',
      '   ',
      '\n\t',
      ZERO_WIDTH_SPACE,
      `${ZERO_WIDTH_JOINER}${EMOJI_SELECTOR}`,
      ` ${SOFT_HYPHEN} `,
    ]) {
      expect(checkChat(text), JSON.stringify(text)).toEqual({ text: '', problem: 'chat_empty' });
    }
    expect(checkChat('?').problem).toBeNull();
    expect(checkChat(HEART).problem).toBeNull();
  });

  test('may be up to 200 characters long, counted after cleaning', () => {
    expect(checkChat('x'.repeat(MAX_CHAT_LENGTH)).problem).toBeNull();
    expect(checkChat('x'.repeat(MAX_CHAT_LENGTH + 1)).problem).toBe('chat_too_long');
    expect(checkChat(HELLO.repeat(MAX_CHAT_LENGTH / 2)).problem).toBeNull();
    expect(checkChat(`${'x'.repeat(MAX_CHAT_LENGTH)}${' '.repeat(50)}`).problem).toBeNull();
    // An emoji outside the basic plane is one character, although it takes two UTF-16 units.
    expect(checkChat('\u{1f600}'.repeat(MAX_CHAT_LENGTH)).problem).toBeNull();
  });

  test('is refused unread when it is far too long', () => {
    expect(checkChat(' '.repeat(MAX_CHAT_INPUT + 1))).toEqual({ text: '', problem: 'chat_too_long' });
    expect(checkChat(`${' '.repeat(MAX_CHAT_INPUT - 2)}ok`)).toEqual({ text: 'ok', problem: null });
  });
});
