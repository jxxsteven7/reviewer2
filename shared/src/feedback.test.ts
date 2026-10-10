import { describe, expect, test } from 'vitest';
import {
  checkContact,
  checkCredit,
  checkFeedback,
  checkLink,
  cleanFeedback,
  MAX_CONTACT_INPUT,
  MAX_CONTACT_LENGTH,
  MAX_LINK_INPUT,
  MAX_LINK_LENGTH,
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

describe('the name for the acknowledgments', () => {
  test('is optional, and one that shows nothing is none', () => {
    for (const text of [undefined, '', '  ', ZERO_WIDTH_SPACE, '\n']) {
      expect(checkCredit(text), JSON.stringify(text)).toEqual({ credit: null, problem: null });
    }
  });

  test('follows the rules of a nickname: cleaned of spaces, refused when hidden or too long', () => {
    expect(checkCredit('  Ann   Lee ')).toEqual({ credit: 'Ann Lee', problem: null });
    expect(checkCredit('octocat')).toEqual({ credit: 'octocat', problem: null });
    expect(checkCredit(HELLO)).toEqual({ credit: HELLO, problem: null });
    for (const text of [`Ann${ZERO_WIDTH_SPACE}Lee`, 'x'.repeat(17), `e${ACUTE.repeat(9)}`]) {
      expect(checkCredit(text), JSON.stringify(text)).toEqual({ credit: null, problem: 'credit_invalid' });
    }
  });

  test('may not be a reserved name, as a nickname may not', () => {
    for (const text of ['admin', ' Reviewer 2 ', 'REVIEWER_2', '\u7ba1\u7406\u5458']) {
      expect(checkCredit(text), JSON.stringify(text)).toEqual({ credit: null, problem: 'credit_reserved' });
    }
  });

  test('that is not text is none', () => {
    expect(checkCredit(7 as unknown as string)).toEqual({ credit: null, problem: null });
  });
});

describe('the link for the acknowledgments', () => {
  test('is optional, and goes with a name only', () => {
    for (const text of [undefined, '', '  ']) {
      expect(checkLink(text, 'Ann'), JSON.stringify(text)).toEqual({ link: null, problem: null });
    }
    expect(checkLink('https://ann.example', null)).toEqual({ link: null, problem: null });
    expect(checkLink('not a link at all', null)).toEqual({ link: null, problem: null });
  });

  test('is a web page of https, such as a homepage or a profile, kept as it was given', () => {
    for (const link of [
      'https://ann.example',
      'https://github.com/octocat',
      'https://orcid.org/0000-0002-1825-0097',
      'https://scholar.google.com/citations?user=AbCdEfGhIjK&hl=en',
      'HTTPS://Ann.Example:8443/a/b%20c#top',
      'https://xn--fiqs8s.example/',
    ]) {
      expect(checkLink(` ${link}\n`, 'Ann'), link).toEqual({ link, problem: null });
    }
  });

  test('is refused when it is no web page of https, or is an email address', () => {
    for (const text of [
      'http://ann.example',
      'ann.example',
      'ftp://ann.example',
      'javascript:alert(1)',
      'mailto:ann@example.com',
      'ann@example.com',
      'https://ann@example.com',
      'https://ann:secret@example.com/',
      'https://localhost/',
      'https://192.168.0.1/',
      'https://-ann.example/',
      'https://ann.example/a b',
      `https://${HELLO}.example/`,
      `https://ann.example/${HELLO}`,
      'https://',
    ]) {
      expect(checkLink(text, 'Ann'), JSON.stringify(text)).toEqual({ link: null, problem: 'credit_link_invalid' });
    }
  });

  test('keeps ( ) percent-encoded, as Markdown would read them, and takes no backslash or character reference', () => {
    expect(checkLink('https://en.wikipedia.org/wiki/Ann_(dev)', 'Ann')).toEqual({
      link: 'https://en.wikipedia.org/wiki/Ann_%28dev%29',
      problem: null,
    });
    expect(checkLink('https://ann.example/a)b', 'Ann')).toEqual({
      link: 'https://ann.example/a%29b',
      problem: null,
    });
    expect(checkLink('https://ann.example/%28x%29', 'Ann')).toEqual({
      link: 'https://ann.example/%28x%29',
      problem: null,
    });
    expect(checkLink('https://ann.example/?a=1&b=2', 'Ann')).toEqual({
      link: 'https://ann.example/?a=1&b=2',
      problem: null,
    });
    for (const text of [
      'https://ann.example/?a=1&amp;b=2',
      'https://ann.example/&#40;',
      'https://ann.example/&#x28;',
      // A browser would go to /users/ann.
      'https://ann.example/users\\ann',
      'https://ann.example/?q=a\\b',
    ]) {
      expect(checkLink(text, 'Ann'), text).toEqual({ link: null, problem: 'credit_link_invalid' });
    }
  });

  test('is 200 characters at most, as it is kept', () => {
    const longest = `https://ann.example/${'x'.repeat(MAX_LINK_LENGTH - 20)}`;
    expect(checkLink(longest, 'Ann')).toEqual({ link: longest, problem: null });
    expect(checkLink(`${longest}x`, 'Ann')).toEqual({ link: null, problem: 'credit_link_too_long' });
    expect(checkLink(`${longest.slice(0, -2)}()`, 'Ann')).toEqual({ link: null, problem: 'credit_link_too_long' });
    expect(checkLink(' '.repeat(MAX_LINK_INPUT + 1), 'Ann')).toEqual({ link: null, problem: 'credit_link_too_long' });
  });

  test('that is not text is none', () => {
    expect(checkLink(7 as unknown as string, 'Ann')).toEqual({ link: null, problem: null });
  });
});
