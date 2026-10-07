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
// Emoji with a joiner right after a selector.
const HEART_ON_FIRE = `${HEART}${ZERO_WIDTH_JOINER}\u{1f525}`;
const KISS = `\u{1f469}${ZERO_WIDTH_JOINER}${HEART}${ZERO_WIDTH_JOINER}\u{1f48b}${ZERO_WIDTH_JOINER}\u{1f468}`;
const RAINBOW_FLAG = `\u{1f3f3}${EMOJI_SELECTOR}${ZERO_WIDTH_JOINER}\u{1f308}`;
// A black flag followed by tag characters: the flag of Scotland, and one that no device shows.
const BLACK_FLAG = '\u{1f3f4}';
const SCOTLAND = `${BLACK_FLAG}\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}`;
const TAGGED_FLAG = `${BLACK_FLAG}\u{e0075}\u{e0073}\u{e0074}\u{e0078}\u{e007f}`;
// Letters written with a joiner after a mark: "Sri" in Sinhala, and the Devanagari "ksha" with
// its first half shown.
const SINHALA_SRI = `\u0dc1\u0dca${ZERO_WIDTH_JOINER}\u0dbb\u0dd3`;
const DEVANAGARI_HALF_KSHA = `\u0915\u094d${ZERO_WIDTH_JOINER}\u0937`;
// Letters with runs of four and three marks: "rope" in Burmese, and a Tibetan syllable.
const BURMESE_ROPE = '\u1000\u103c\u102d\u102f\u1038';
const TIBETAN_SYLLABLE = '\u0f66\u0f92\u0fb2\u0f74\u0f42';
const HELLO = '\u4f60\u597d'; // "hello" in Chinese

describe('a chat message', () => {
  test('is kept as it was typed, on one line', () => {
    expect(checkChat('Card 3, I think.')).toEqual({ text: 'Card 3, I think.', problem: null });
    expect(cleanChat('  two\n\nlines\tand   spaces ')).toBe('two lines and spaces');
    expect(cleanChat(`${HELLO}\uff01 R\u00b2`)).toBe(`${HELLO}\uff01 R\u00b2`);
    expect(cleanChat('bell\u0007and\u0000null')).toBe('bell and null');
  });

  test('loses invisible characters, but keeps the emoji that are built with a joiner or a selector', () => {
    expect(cleanChat(`a${ZERO_WIDTH_SPACE}b${SOFT_HYPHEN}c`)).toBe('abc');
    expect(cleanChat(`${RIGHT_TO_LEFT_OVERRIDE}abc`)).toBe('abc');
    expect(cleanChat(`${HEART} ${FAMILY}`)).toBe(`${HEART} ${FAMILY}`);
    for (const emoji of [HEART_ON_FIRE, KISS, RAINBOW_FLAG]) {
      expect(cleanChat(`ok ${emoji}`), JSON.stringify(emoji)).toBe(`ok ${emoji}`);
    }
  });

  test('keeps the tags of the flags of England, Scotland and Wales, and no others', () => {
    expect(cleanChat(`${SCOTLAND} hi`)).toBe(`${SCOTLAND} hi`);
    expect(cleanChat(`${TAGGED_FLAG} hi`)).toBe(`${BLACK_FLAG} hi`);
    expect(cleanChat(`a\u{e0061}b${SCOTLAND.slice(0, -2)}`)).toBe(`ab${BLACK_FLAG}`);
  });

  test('keeps the letters of scripts that use joiners or stack their marks', () => {
    for (const word of [SINHALA_SRI, DEVANAGARI_HALF_KSHA, BURMESE_ROPE, TIBETAN_SYLLABLE]) {
      expect(cleanChat(word), JSON.stringify(word)).toBe(word);
    }
  });

  test('keeps accents, but no pile of them', () => {
    expect(cleanChat(`cafe${ACUTE}`)).toBe(`cafe${ACUTE}`);
    expect(cleanChat(`e${ACUTE.repeat(4)}!`)).toBe(`e${ACUTE.repeat(4)}!`);
    expect(cleanChat(`e${ACUTE.repeat(40)}!`)).toBe(`e${ACUTE.repeat(4)}!`);
    // Joiners between the marks don't keep the pile standing, and selectors are marks too.
    expect(cleanChat(`e${`${ACUTE}${ACUTE}${ZERO_WIDTH_JOINER}`.repeat(60)}!`)).toBe(
      `e${ACUTE}${ACUTE}${ZERO_WIDTH_JOINER}${ACUTE}${ACUTE}!`,
    );
    expect(cleanChat(`e${`${ACUTE}${EMOJI_SELECTOR}`.repeat(60)}!`)).toBe(`e${`${ACUTE}${EMOJI_SELECTOR}`.repeat(2)}!`);
    expect(cleanChat(`e${ACUTE.repeat(5)}${ZERO_WIDTH_JOINER}\u{1f525}`)).toBe(`e${ACUTE.repeat(4)}\u{1f525}`);
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
    // Whatever a player sends instead of a text is no message either.
    for (const text of [42, null, undefined, ['hi'], {}]) {
      expect(checkChat(text as unknown as string), JSON.stringify(text)).toEqual({ text: '', problem: 'chat_empty' });
    }
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
