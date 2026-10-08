import { afterEach, describe, expect, test, vi } from 'vitest';
import { dropHidden, MAX_MARKS, showsSomething, textLength, trimMarks, trimStrays } from './text';

// Hidden characters, marks and emoji are written as \u escapes, so that they can be told apart.
const ACUTE = '\u0301';
const ZERO_WIDTH_JOINER = '\u200d';
const ZERO_WIDTH_NON_JOINER = '\u200c';
const RIGHT_TO_LEFT_MARK = '\u200f';
const EMOJI_SELECTOR = '\ufe0f';
const DEVANAGARI_AA = '\u093e'; // a mark that stands beside its letter
const BLACK_FLAG = '\u{1f3f4}';
const flag = (tags: string): string =>
  `${BLACK_FLAG}${[...tags].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('')}\u{e007f}`;
const SCOTLAND = flag('gbsct');
const KISS = `\u{1f469}${ZERO_WIDTH_JOINER}\u2764${EMOJI_SELECTOR}${ZERO_WIDTH_JOINER}\u{1f48b}${ZERO_WIDTH_JOINER}\u{1f468}`;

describe('dropHidden', () => {
  test('drops what shows nothing, or shows differently everywhere', () => {
    // A zero-width space, a soft hyphen, a direction override, a bidi isolate, a word joiner, a
    // byte order mark, a grapheme joiner, a language tag, a Hangul filler, an interlinear
    // annotation anchor, a private-use character, half of a surrogate pair, a control character
    // and the blank Braille pattern.
    for (const hidden of [
      '\u200b',
      '\u00ad',
      '\u202e',
      '\u2066',
      '\u2060',
      '\ufeff',
      '\u034f',
      '\u{e0001}',
      '\u3164',
      '\ufff9',
      '\ue000',
      '\ud800',
      '\u0007',
      '\u2800',
    ]) {
      expect(dropHidden(`a${hidden}b`), JSON.stringify(hidden)).toBe('ab');
    }
  });

  test('keeps the silent characters that letters and emoji are built with', () => {
    // Both joiners, an emoji selector, a selector for a Chinese character, a Mongolian free
    // variation selector and vowel separator, and the three direction marks.
    for (const silent of [
      ZERO_WIDTH_JOINER,
      ZERO_WIDTH_NON_JOINER,
      EMOJI_SELECTOR,
      '\u{e0100}',
      '\u180b',
      '\u180e',
      '\u200e',
      RIGHT_TO_LEFT_MARK,
      '\u061c',
    ]) {
      expect(dropHidden(`a${silent}b`), JSON.stringify(silent)).toBe(`a${silent}b`);
    }
  });

  test('keeps the number signs, which are format characters but shown', () => {
    expect(dropHidden('\u0600\u0661\u0662')).toBe('\u0600\u0661\u0662');
    expect(dropHidden('\u06dd\u0661')).toBe('\u06dd\u0661');
  });

  test('keeps the tags of the flags of England, Scotland and Wales, and no others', () => {
    for (const tags of ['gbeng', 'gbsct', 'gbwls']) expect(dropHidden(flag(tags)), tags).toBe(flag(tags));
    for (const tags of ['gbxyz', 'usca', 'ann']) expect(dropHidden(flag(tags)), tags).toBe(BLACK_FLAG);
    expect(dropHidden(SCOTLAND.slice(0, -2))).toBe(BLACK_FLAG); // without the tag that ends it
    expect(dropHidden(`a\u{e0061}b${SCOTLAND}`)).toBe(`ab${SCOTLAND}`);
  });
});

describe('trimMarks', () => {
  test('keeps four marks of each kind on a character, and loses the rest', () => {
    expect(MAX_MARKS).toBe(4);
    expect(trimMarks(`e${ACUTE.repeat(4)}!`)).toBe(`e${ACUTE.repeat(4)}!`);
    expect(trimMarks(`e${ACUTE.repeat(40)}!`)).toBe(`e${ACUTE.repeat(4)}!`);
    expect(trimMarks(`\u0915${DEVANAGARI_AA.repeat(10)}`)).toBe(`\u0915${DEVANAGARI_AA.repeat(4)}`);
    // Marks of the two kinds are counted apart: "hope" in Burmese has three marks beside its
    // letter and two on it.
    const burmeseHope = '\u1019\u103b\u103e\u1031\u102c\u103a';
    expect(trimMarks(burmeseHope)).toBe(burmeseHope);
    expect(trimMarks(`${burmeseHope}${ACUTE.repeat(3)}`)).toBe(`${burmeseHope}${ACUTE.repeat(2)}`);
  });

  test('measures a run as a whole, whatever stands between its marks', () => {
    // Joiners, selectors and direction marks don't split a pile into short runs, and no more
    // than four of them stay either.
    expect(trimMarks(`e${`${ACUTE}${ACUTE}${ZERO_WIDTH_JOINER}`.repeat(60)}!`)).toBe(
      `e${ACUTE}${ACUTE}${ZERO_WIDTH_JOINER}${ACUTE}${ACUTE}${ZERO_WIDTH_JOINER.repeat(3)}!`,
    );
    expect(trimMarks(`e${`${ACUTE}${EMOJI_SELECTOR}`.repeat(60)}!`)).toBe(`e${`${ACUTE}${EMOJI_SELECTOR}`.repeat(2)}!`);
    expect(trimMarks(`e${`${ACUTE.repeat(4)}${RIGHT_TO_LEFT_MARK}`.repeat(10)}`)).toBe(
      `e${ACUTE.repeat(4)}${RIGHT_TO_LEFT_MARK.repeat(4)}`,
    );
    expect(trimMarks(`e${ACUTE.repeat(5)}${ZERO_WIDTH_JOINER}\u{1f525}`)).toBe(
      `e${ACUTE.repeat(4)}${ZERO_WIDTH_JOINER}\u{1f525}`,
    );
    // A letter between the marks starts a new run.
    expect(trimMarks(`e${ACUTE.repeat(4)}e${ACUTE.repeat(4)}`)).toBe(`e${ACUTE.repeat(4)}e${ACUTE.repeat(4)}`);
  });

  test('leaves emoji alone', () => {
    for (const emoji of [
      KISS,
      `\u2764${EMOJI_SELECTOR}${ZERO_WIDTH_JOINER}\u{1f525}`,
      `1${EMOJI_SELECTOR}\u20e3`,
      SCOTLAND,
    ]) {
      expect(trimMarks(emoji), JSON.stringify(emoji)).toBe(emoji);
    }
  });
});

describe('trimStrays', () => {
  test('takes marks and silent characters off the ends, with the spaces around them', () => {
    expect(trimStrays(` ${ACUTE}${ACUTE} hi`)).toBe('hi');
    expect(trimStrays(`${ZERO_WIDTH_JOINER}${EMOJI_SELECTOR} hi`)).toBe('hi');
    expect(trimStrays(`${RIGHT_TO_LEFT_MARK}hi`)).toBe('hi');
    expect(trimStrays(`hi ${ZERO_WIDTH_JOINER}`)).toBe('hi');
    expect(trimStrays(`hi ${ACUTE} `)).toBe('hi');
    expect(trimStrays(ACUTE)).toBe('');
  });

  test('leaves the marks and silent characters that stand with a letter', () => {
    for (const text of [`cafe${ACUTE}`, `a ${ACUTE}b`, `\u0645\u0631!\u061c`, `hi\u2764${EMOJI_SELECTOR}`, 'a b']) {
      expect(trimStrays(text), JSON.stringify(text)).toBe(text);
    }
  });
});

describe('showsSomething', () => {
  test('is false for spaces, marks and silent characters alone', () => {
    for (const nothing of [
      '',
      ' ',
      ACUTE,
      ZERO_WIDTH_JOINER,
      ZERO_WIDTH_NON_JOINER,
      EMOJI_SELECTOR,
      RIGHT_TO_LEFT_MARK,
      '\u115f',
      '\u2800',
    ]) {
      expect(showsSomething(nothing), JSON.stringify(nothing)).toBe(false);
    }
  });

  test('is true for a letter, an emoji or a number sign', () => {
    for (const something of ['a', '\u4f60', `\u2764${EMOJI_SELECTOR}`, SCOTLAND, '\u06dd', `e${ACUTE}`]) {
      expect(showsSomething(something), JSON.stringify(something)).toBe(true);
    }
  });
});

describe('textLength', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  test('counts the characters a reader sees', () => {
    expect(textLength('')).toBe(0);
    expect(textLength('abc')).toBe(3);
    expect(textLength('\u{1f600}')).toBe(1);
    for (const one of [KISS, SCOTLAND, `e${ACUTE}`, '\u{1f1f8}\u{1f1ec}', `1${EMOJI_SELECTOR}\u20e3`]) {
      expect(textLength(one), JSON.stringify(one)).toBe(1);
    }
  });

  test('counts code points where Intl.Segmenter is missing', async () => {
    vi.stubGlobal('Intl', Object.create(Intl as object, { Segmenter: { value: undefined } }) as typeof Intl);
    vi.resetModules();
    const { textLength: withoutSegmenter } = await import('./text');
    expect(withoutSegmenter('abc')).toBe(3);
    expect(withoutSegmenter('\u{1f600}')).toBe(1);
    expect(withoutSegmenter(SCOTLAND)).toBe(7);
  });
});
