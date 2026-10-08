import { describe, expect, test } from 'vitest';
import { cleanName, sameName } from './names';
import { MAX_NAME_INPUT, MAX_NAME_LENGTH } from './protocol';

const scientist = '\u{1f469}\u200d\u{1f52c}';
const family = '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}\u200d\u{1f466}';
const england = '\u{1f3f4}\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}';
// The longest emoji there is: two people with skin tones, a heart and a kiss, in 10 code points.
const kiss = '\u{1f9d1}\u{1f3fb}\u200d\u2764\ufe0f\u200d\u{1f48b}\u200d\u{1f9d1}\u{1f3fc}';

describe('a nickname', () => {
  test('is trimmed, folded and limited to 16 characters', () => {
    expect(cleanName('  Ann  ')).toBe('Ann');
    expect(cleanName('Ann   Lee')).toBe('Ann Lee');
    expect(cleanName('A\nB')).toBe('A B');
    expect(cleanName('\uff21\uff4e\uff4e')).toBe('Ann');
    expect(cleanName('x'.repeat(16))).toBe('x'.repeat(16));
    expect(cleanName('x'.repeat(17))).toBeNull();
    for (const empty of ['', '   ', '\u3000']) expect(cleanName(empty), JSON.stringify(empty)).toBeNull();
  });

  test('is not looked at when the text is far too long to be one', () => {
    expect(cleanName(`Ann${' '.repeat(MAX_NAME_INPUT - 3)}`)).toBe('Ann');
    expect(cleanName(`Ann${' '.repeat(MAX_NAME_INPUT - 2)}`)).toBeNull();
    expect(kiss.repeat(MAX_NAME_LENGTH).length).toBeLessThanOrEqual(MAX_NAME_INPUT);
  });

  test('counts an emoji as one character, however it is built', () => {
    for (const emoji of [
      scientist,
      family,
      kiss,
      england,
      '\u{1f1f8}\u{1f1ec}',
      '#\ufe0f\u20e3',
      '\u{1f44d}\u{1f3fd}',
    ]) {
      expect(cleanName(emoji.repeat(16)), emoji).toBe(emoji.repeat(16));
      expect(cleanName(emoji.repeat(17)), emoji).toBeNull();
    }
  });

  test("can't hide a character that makes it look like someone else's", () => {
    // A zero-width space, a soft hyphen, a bidi isolate, a grapheme joiner, a tag character and
    // an interlinear annotation anchor.
    for (const hidden of ['\u200b', '\u00ad', '\u2066', '\u034f', '\u{e0041}', '\ufff9']) {
      expect(cleanName(`An${hidden}n`), JSON.stringify(hidden)).toBeNull();
      expect(cleanName(`Ann${hidden}`), JSON.stringify(hidden)).toBeNull();
    }
    for (const bad of ['A\u202enn', 'A\u0000', '\ue000', '\ud800', 'A\u{f0000}', 'An\u2800n']) {
      expect(cleanName(bad), JSON.stringify(bad)).toBeNull();
    }
    // A byte order mark counts as a space, so it shows when it stands inside a name.
    expect(cleanName('An\ufeffn')).toBe('An n');
    expect(cleanName('Ann\ufeff')).toBe('Ann');
  });

  test("can't be one that shows nothing", () => {
    // Hangul fillers, the joiners and the selectors by themselves, a direction mark and the
    // blank Braille pattern.
    for (const blank of [
      '\u3164',
      '\u115f',
      '\u1160',
      '\uffa0',
      '\u200d',
      '\u200c',
      '\ufe0f',
      '\u200d\ufe0f',
      '\u200f',
      '\u2800',
    ]) {
      expect(cleanName(blank), JSON.stringify(blank)).toBeNull();
    }
  });

  test("can't pile up combining marks, or carry one with nothing to sit on", () => {
    expect(cleanName('A' + '\u0301'.repeat(60))).toBeNull();
    expect(cleanName('x' + '\u0301'.repeat(5))).toBeNull();
    expect(cleanName('x' + '\u0301'.repeat(4))).not.toBeNull();
    // Marks that stand beside the letter are counted apart from those that sit on it, and are
    // limited to four as well.
    expect(cleanName('\u0915' + '\u093e'.repeat(4))).not.toBeNull();
    expect(cleanName('\u0915' + '\u093e'.repeat(5))).toBeNull();
    // A mark at the start would settle on whatever stands before the name on the page, and one
    // after the last letter hides a space.
    expect(cleanName('\u0301A')).toBeNull();
    expect(cleanName('Ann \u0301')).toBeNull();
    // A selector, a joiner or a direction mark between the marks hides the run from nobody.
    expect(cleanName('A' + '\u0301\ufe0f'.repeat(8))).toBeNull();
    expect(cleanName('x' + '\u0301\u200d'.repeat(5))).toBeNull();
    expect(cleanName('x' + '\u200d\u0301'.repeat(5))).toBeNull();
    expect(cleanName('x' + '\u0301\u200f'.repeat(5))).toBeNull();
    expect(cleanName('\u200d\u0301A')).toBeNull();
    // A joiner after a selector is how some emoji are built: a heart on fire, a keycap.
    expect(cleanName('Ann \u2764\ufe0f\u200d\u{1f525}')).not.toBeNull();
    expect(cleanName('Ann 1\ufe0f\u20e3')).not.toBeNull();
  });

  test('may be written in any script', () => {
    // Chinese, Thai, Arabic with its vowel marks, Tibetan with stacked letters, Sinhala and
    // Devanagari with a joiner after the mark that binds two letters, Persian with the non-joiner
    // that keeps two letters apart, Burmese with five marks on one letter, Mongolian with a
    // variation selector and the vowel separator, a Chinese character in its variant form, and
    // Vietnamese typed as letters and separate marks.
    for (const name of [
      '\u0dc1\u0dca\u200d\u0dbb\u0dd3',
      '\u0915\u094d\u200d\u0937',
      '\u5f20\u4f1f',
      '\u0e2a\u0e21\u0e0a\u0e32\u0e22',
      '\u0645\u064f\u062d\u064e\u0645\u0651\u064e\u062f',
      '\u0f56\u0f66\u0f92\u0fb2\u0f74\u0f56\u0f66',
      '\u0645\u06cc\u200c\u0644\u0627\u062f',
      '\u1019\u103b\u103e\u1031\u102c\u103a',
      '\u1820\u180b\u1821 \u1828\u180e\u1820',
      '\u845b\u{e0100}',
    ]) {
      expect(cleanName(name), name).toBe(name.normalize('NFKC'));
    }
    expect(cleanName('Nguye\u0302\u0303n')).toBe('Nguy\u1ec5n');
  });

  test('may carry the flags that are spelled with tag characters, and no other tags', () => {
    const flag = (tags: string) =>
      `\u{1f3f4}${[...tags].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('')}\u{e007f}`;
    for (const tags of ['gbeng', 'gbsct', 'gbwls']) expect(cleanName(`Ann ${flag(tags)}`), tags).not.toBeNull();
    for (const tags of ['gbxyz', 'usca', 'ann']) expect(cleanName(`Ann ${flag(tags)}`), tags).toBeNull();
    expect(cleanName(england.slice(0, -2))).toBeNull(); // without the tag that ends it
  });
});

describe('two nicknames', () => {
  test('clash when they differ only in case', () => {
    expect(sameName('Ann', 'ANN')).toBe(true);
    expect(sameName('Ann', 'Anne')).toBe(false);
  });

  test('clash when they differ only in what shows nothing', () => {
    // A selector, a joiner, a non-joiner or a direction mark where no letter or emoji needs it
    // is a valid name that looks like "Ann".
    for (const silent of ['\ufe0f', '\u200d', '\u200c', '\u200f', '\ufe00']) {
      expect(cleanName(`An${silent}n`), JSON.stringify(silent)).not.toBeNull();
      expect(sameName('Ann', `An${silent}n`), JSON.stringify(silent)).toBe(true);
    }
    expect(sameName('Ann', 'Ann\ufe0f')).toBe(true);
    expect(sameName(scientist, family)).toBe(false);
  });
});
