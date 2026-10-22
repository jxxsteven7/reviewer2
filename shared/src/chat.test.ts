import { describe, expect, test } from 'vitest';
import { checkChat, cleanChat, MAX_CHAT_INPUT, MAX_CHAT_LENGTH } from './chat';

// Hidden characters, combining marks and emoji are written as \u escapes, so that they can be
// told apart here. text.test.ts goes through the rules one by one; these tests check what the chat
// makes of them.
const ZERO_WIDTH_SPACE = '\u200b';
const RIGHT_TO_LEFT_OVERRIDE = '\u202e';
const RIGHT_TO_LEFT_MARK = '\u200f';
const SOFT_HYPHEN = '\u00ad';
const ACUTE = '\u0301';
const ZERO_WIDTH_JOINER = '\u200d';
const ZERO_WIDTH_NON_JOINER = '\u200c';
const EMOJI_SELECTOR = '\ufe0f';
const HEART = `\u2764${EMOJI_SELECTOR}`;
const FAMILY = `\u{1f468}${ZERO_WIDTH_JOINER}\u{1f469}${ZERO_WIDTH_JOINER}\u{1f467}`;
// Emoji with a joiner right after a selector.
const HEART_ON_FIRE = `${HEART}${ZERO_WIDTH_JOINER}\u{1f525}`;
const KISS = `\u{1f469}${ZERO_WIDTH_JOINER}${HEART}${ZERO_WIDTH_JOINER}\u{1f48b}${ZERO_WIDTH_JOINER}\u{1f468}`;
const RAINBOW_FLAG = `\u{1f3f3}${EMOJI_SELECTOR}${ZERO_WIDTH_JOINER}\u{1f308}`;
// A black flag followed by tag characters: the three flags that are spelled so, and one that no
// device shows.
const BLACK_FLAG = '\u{1f3f4}';
const flag = (tags: string): string =>
  `${BLACK_FLAG}${[...tags].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('')}\u{e007f}`;
const SCOTLAND = flag('gbsct');
const TAGGED_FLAG = flag('ustx');
// Letters written with a joiner or a non-joiner after a mark: "Sri" in Sinhala, the Devanagari
// "ksha" with its first half shown, and the two letters kept apart.
const SINHALA_SRI = `\u0dc1\u0dca${ZERO_WIDTH_JOINER}\u0dbb\u0dd3`;
const DEVANAGARI_HALF_KSHA = `\u0915\u094d${ZERO_WIDTH_JOINER}\u0937`;
const DEVANAGARI_K_SHA = `\u0915\u094d${ZERO_WIDTH_NON_JOINER}\u0937`;
// Words with a non-joiner between letters, as Persian writes them: "I want".
const PERSIAN_I_WANT = `\u0645\u06cc${ZERO_WIDTH_NON_JOINER}\u062e\u0648\u0627\u0647\u0645`;
// Letters with runs of marks: "rope" (four) and "hope" (five, three of them beside the letter) in
// Burmese, a Tibetan syllable (three), and a Hebrew letter with its dot, dagesh, vowel and accent.
const BURMESE_ROPE = '\u1000\u103c\u102d\u102f\u1038';
const BURMESE_HOPE = '\u1019\u103b\u103e\u1031\u102c\u103a';
const TIBETAN_SYLLABLE = '\u0f66\u0f92\u0fb2\u0f74\u0f42';
const HEBREW_SHIN = '\u05e9\u05c1\u05bc\u05b8\u0591';
// Letters that a selector or a separator chooses the shape of: Mongolian, and a Chinese character
// in the variant form that names are written in.
const MONGOLIAN = '\u1820\u180b\u1821 \u1828\u180e\u1820';
const HAN_VARIANT = '\u845b\u{e0100}';
// Arabic with the sign that ends an ayah, and a word ended by a direction mark, so that its
// punctuation stays on its side.
const ARABIC = `\u06dd\u0661 \u0645\u0631!${RIGHT_TO_LEFT_MARK}`;
const HELLO = '\u4f60\u597d'; // "hello" in Chinese

describe('a chat message', () => {
  test('is kept as it was typed, on one line', () => {
    expect(checkChat('Card 3, I think.')).toEqual({ text: 'Card 3, I think.', problem: null });
    expect(cleanChat('  two\n\nlines\tand   spaces ')).toBe('two lines and spaces');
    expect(cleanChat(`${HELLO}\uff01 R\u00b2`)).toBe(`${HELLO}\uff01 R\u00b2`);
    expect(cleanChat('bell\u0007and\u0000null')).toBe('bell and null');
    expect(cleanChat('a\u2800\u2800b')).toBe('a b'); // the blank Braille pattern is a space
  });

  test('loses hidden characters, but keeps the emoji that are built with a joiner or a selector', () => {
    expect(cleanChat(`a${ZERO_WIDTH_SPACE}b${SOFT_HYPHEN}c`)).toBe('abc');
    expect(cleanChat(`${RIGHT_TO_LEFT_OVERRIDE}abc`)).toBe('abc');
    // An interlinear annotation anchor, a private-use character, half of a surrogate pair and a
    // Hangul filler.
    for (const hidden of ['\ufff9', '\ue000', '\ud800', '\u3164']) {
      expect(cleanChat(`a${hidden}b`), JSON.stringify(hidden)).toBe('ab');
    }
    expect(cleanChat(`${HEART} ${FAMILY}`)).toBe(`${HEART} ${FAMILY}`);
    for (const emoji of [HEART_ON_FIRE, KISS, RAINBOW_FLAG, `1${EMOJI_SELECTOR}\u20e3`]) {
      expect(cleanChat(`ok ${emoji}`), JSON.stringify(emoji)).toBe(`ok ${emoji}`);
    }
  });

  test('keeps the tags of the flags of England, Scotland and Wales, and no others', () => {
    for (const tags of ['gbeng', 'gbsct', 'gbwls'])
      expect(cleanChat(`${flag(tags)} hi`), tags).toBe(`${flag(tags)} hi`);
    expect(cleanChat(`${TAGGED_FLAG} hi`)).toBe(`${BLACK_FLAG} hi`);
    expect(cleanChat(`a\u{e0061}b${SCOTLAND.slice(0, -2)}`)).toBe(`ab${BLACK_FLAG}`);
  });

  test('keeps the letters of every script', () => {
    for (const word of [
      SINHALA_SRI,
      DEVANAGARI_HALF_KSHA,
      DEVANAGARI_K_SHA,
      PERSIAN_I_WANT,
      BURMESE_ROPE,
      BURMESE_HOPE,
      TIBETAN_SYLLABLE,
      HEBREW_SHIN,
      MONGOLIAN,
      HAN_VARIANT,
      ARABIC,
    ]) {
      expect(cleanChat(word), JSON.stringify(word)).toBe(word);
    }
  });

  test('keeps accents, but no pile of them', () => {
    expect(cleanChat(`cafe${ACUTE}`)).toBe(`cafe${ACUTE}`);
    expect(cleanChat(`e${ACUTE.repeat(4)}!`)).toBe(`e${ACUTE.repeat(4)}!`);
    expect(cleanChat(`e${ACUTE.repeat(40)}!`)).toBe(`e${ACUTE.repeat(4)}!`);
    // Neither joiners nor hidden characters between the marks keep the pile standing.
    expect(cleanChat(`e${`${ACUTE}${ACUTE}${ZERO_WIDTH_JOINER}`.repeat(60)}!`)).toBe(
      `e${ACUTE}${ACUTE}${ZERO_WIDTH_JOINER}${ACUTE}${ACUTE}${ZERO_WIDTH_JOINER.repeat(3)}!`,
    );
    expect(cleanChat(`e${`${ACUTE.repeat(4)}\ufff9`.repeat(10)}!`)).toBe(`e${ACUTE.repeat(4)}!`);
    expect(cleanChat(`e${ACUTE.repeat(5)}${ZERO_WIDTH_JOINER}\u{1f525}`)).toBe(
      `e${ACUTE.repeat(4)}${ZERO_WIDTH_JOINER}\u{1f525}`,
    );
    // Marks that stand beside a letter can't make it as wide as a line either.
    expect(cleanChat(`\u0915${'\u093e'.repeat(10)}`)).toBe(`\u0915${'\u093e'.repeat(4)}`);
  });

  test('starts and ends with something that shows', () => {
    // A mark at the start would settle on the name of the sender, which stands right before the
    // message on the page.
    expect(cleanChat(` ${ACUTE.repeat(4)}hi`)).toBe('hi');
    expect(cleanChat(`${ZERO_WIDTH_JOINER}${EMOJI_SELECTOR} hi`)).toBe('hi');
    expect(cleanChat(`hi ${ZERO_WIDTH_JOINER}`)).toBe('hi');
    expect(cleanChat(`hi ${ACUTE} `)).toBe('hi');
    expect(cleanChat(`hi ${HEART}`)).toBe(`hi ${HEART}`);
  });

  test('must show something', () => {
    for (const text of [
      '',
      '   ',
      '\n\t',
      ZERO_WIDTH_SPACE,
      ZERO_WIDTH_NON_JOINER,
      RIGHT_TO_LEFT_MARK,
      `${ZERO_WIDTH_JOINER}${EMOJI_SELECTOR}`,
      ` ${SOFT_HYPHEN} `,
      ACUTE,
      '\u2800\u2800',
      TAGGED_FLAG.slice(2), // tags without their flag
    ]) {
      expect(checkChat(text), JSON.stringify(text)).toEqual({ text: '', problem: 'chat_empty' });
    }
    expect(checkChat('?').problem).toBeNull();
    expect(checkChat(HEART).problem).toBeNull();
    expect(checkChat(SCOTLAND).problem).toBeNull();
    // Whatever a player sends instead of a text is no message either.
    for (const text of [42, null, undefined, ['hi'], {}]) {
      expect(checkChat(text as unknown as string), JSON.stringify(text)).toEqual({ text: '', problem: 'chat_empty' });
    }
  });

  test('may be up to 200 characters long, as a reader counts them, once it is cleaned', () => {
    expect(checkChat('x'.repeat(MAX_CHAT_LENGTH)).problem).toBeNull();
    expect(checkChat('x'.repeat(MAX_CHAT_LENGTH + 1)).problem).toBe('chat_too_long');
    expect(checkChat(HELLO.repeat(MAX_CHAT_LENGTH / 2)).problem).toBeNull();
    expect(checkChat(`${'x'.repeat(MAX_CHAT_LENGTH)}${' '.repeat(50)}`).problem).toBeNull();
    // An emoji is one character, however many code points it is built from: 70 flags of Scotland
    // are 490 code points.
    expect(checkChat('\u{1f600}'.repeat(MAX_CHAT_LENGTH)).problem).toBeNull();
    expect(checkChat(SCOTLAND.repeat(70)).problem).toBeNull();
    expect(checkChat(`${FAMILY.repeat(MAX_CHAT_LENGTH)}`).problem).toBe('chat_too_long'); // 1,600 UTF-16 units
  });

  test('is refused unread when it is far too long', () => {
    expect(checkChat(' '.repeat(MAX_CHAT_INPUT + 1))).toEqual({ text: '', problem: 'chat_too_long' });
    expect(checkChat(`${' '.repeat(MAX_CHAT_INPUT - 2)}ok`)).toEqual({ text: 'ok', problem: null });
  });
});
