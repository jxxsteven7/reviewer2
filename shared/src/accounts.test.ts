import { describe, expect, test } from 'vitest';
import {
  checkBio,
  checkPassword,
  checkUsername,
  HANDLE,
  MAX_BIO_INPUT,
  MAX_BIO_LENGTH,
  isReservedName,
  looksLikeEmail,
  MAX_PASSWORD_INPUT,
  normalizePassword,
  usernameKey,
} from './accounts';

// Letters outside ASCII are written as escapes, so that look-alikes can be told apart.
const FULL_WIDTH_ANN = '\u{ff21}\u{ff4e}\u{ff4e}';
const CYRILLIC_A = '\u{430}';
const GREEK_ALPHA_BETA = '\u{3b1}\u{3b2}';
const CYRILLIC_NAME = '\u{418}\u{432}\u{430}\u{43d}';
const ZHANG_SAN = '\u{5f20}\u{4e09}';
const SHARP_S = '\u{df}';
const FINAL_SIGMA = '\u{3c2}';
const SIGMA = '\u{3c3}';
const ZERO_WIDTH_JOINER = '\u{200d}';

describe('a username', () => {
  test('keeps the rules of a nickname and has at least two characters', () => {
    expect(checkUsername('  Ann   Lee ')).toEqual({ username: 'Ann Lee', problem: null });
    expect(checkUsername(FULL_WIDTH_ANN)).toEqual({ username: 'Ann', problem: null });
    expect(checkUsername(ZHANG_SAN)).toEqual({ username: ZHANG_SAN, problem: null });
    expect(checkUsername('A')).toEqual({ username: null, problem: 'username_short' });
    expect(checkUsername(ZHANG_SAN.slice(0, 1))).toEqual({ username: null, problem: 'username_short' });
    expect(checkUsername('x'.repeat(16)).problem).toBeNull();
    for (const invalid of ['', '   ', 'x'.repeat(17), 'Ann\u{200b}Lee']) {
      expect(checkUsername(invalid), JSON.stringify(invalid)).toEqual({ username: null, problem: 'username_invalid' });
    }
    expect(checkUsername(42 as unknown as string).problem).toBe('username_invalid');
  });

  test('may not mix Latin, Greek and Cyrillic letters', () => {
    expect(checkUsername(`${CYRILLIC_A}dmin`).problem).toBe('username_mixed');
    expect(checkUsername(`Ann${GREEK_ALPHA_BETA}`).problem).toBe('username_mixed');
    expect(checkUsername(GREEK_ALPHA_BETA).problem).toBeNull();
    expect(checkUsername(CYRILLIC_NAME).problem).toBeNull();
    // Other scripts, digits and signs go with any of them.
    expect(checkUsername(`Ann${ZHANG_SAN}`).problem).toBeNull();
    expect(checkUsername(`${CYRILLIC_NAME} 2`).problem).toBeNull();
  });

  test('may not be one of the reserved names, however it is spaced or cased', () => {
    for (const name of [
      'admin',
      'ADMIN',
      '\u{ff21}\u{ff24}\u{ff2d}\u{ff29}\u{ff2e}',
      'Reviewer 2',
      'reviewer_2',
      'Reviewer-2',
      'PlayReviewer2',
      '\u{7ba1}\u{7406}\u{5458}',
      // The AI player's names.
      'Reviewer 1',
      '\u{4e00}\u{53f7}\u{5ba1}\u{7a3f}\u{4eba}',
    ]) {
      expect(checkUsername(name).problem, name).toBe('username_reserved');
    }
    expect(checkUsername('Reviewer 3').problem).toBeNull();
    expect(checkUsername('administrators').problem).toBeNull();
    // A guest's nickname may not be one either.
    expect(isReservedName('Reviewer 2')).toBe(true);
    expect(isReservedName('Reviewer 3')).toBe(false);
  });
});

describe('the key of a name', () => {
  test('folds case, full-width forms and silent characters', () => {
    expect(usernameKey('Ann')).toBe('ann');
    expect(usernameKey(FULL_WIDTH_ANN)).toBe('ann');
    expect(usernameKey('ANN')).toBe(usernameKey('ann'));
    expect(usernameKey(`An${ZERO_WIDTH_JOINER}n`)).toBe('ann');
  });

  test('folds what lower case alone leaves apart', () => {
    expect(usernameKey(`Stra${SHARP_S}e`)).toBe(usernameKey('STRASSE'));
    expect(usernameKey(`${SIGMA}o${FINAL_SIGMA}`)).toBe(usernameKey(`${SIGMA}o${SIGMA}`));
  });

  test('keeps different names apart', () => {
    expect(usernameKey('Ann')).not.toBe(usernameKey('Anne'));
    expect(usernameKey('Ann Lee')).not.toBe(usernameKey('AnnLee'));
    expect(usernameKey(ZHANG_SAN)).toBe(ZHANG_SAN);
  });
});

describe('a password', () => {
  test('has 8 to 128 characters, and nothing else is asked of it', () => {
    expect(checkPassword('1234567')).toBe('password_short');
    expect(checkPassword('12345678')).toBeNull();
    expect(checkPassword('        ')).toBeNull();
    expect(checkPassword('x'.repeat(128))).toBeNull();
    expect(checkPassword('x'.repeat(129))).toBe('password_long');
    expect(checkPassword('x'.repeat(MAX_PASSWORD_INPUT + 1))).toBe('password_long');
    expect(checkPassword(undefined)).toBe('password_short');
  });

  test('counts code points once it is normalized', () => {
    expect(checkPassword('\u{1f600}'.repeat(8))).toBeNull();
    expect(checkPassword('\u{1f600}'.repeat(7))).toBe('password_short');
    // Seven full-width letters are seven letters, and one ligature that NFKC spells out in full
    // counts as what it becomes.
    expect(checkPassword('\u{ff50}\u{ff41}\u{ff53}\u{ff53}\u{ff57}\u{ff4f}\u{ff52}')).toBe('password_short');
    expect(checkPassword('\u{fb03}\u{fb03}\u{fb03}')).toBeNull();
  });

  test('typed with a full-width keyboard is the same password', () => {
    expect(normalizePassword('\u{ff50}\u{ff41}\u{ff53}\u{ff53}1234')).toBe('pass1234');
  });
});

describe('an email address', () => {
  test('looks like one to the form', () => {
    expect(looksLikeEmail('ann@example.com')).toBe(true);
    expect(looksLikeEmail('  ann.lee+r2@mail.example.edu.sg ')).toBe(true);
    for (const text of ['', 'ann', 'ann@', '@example.com', 'ann@example', 'ann lee@example.com', 'a@b@c.com']) {
      expect(looksLikeEmail(text), text).toBe(false);
    }
    expect(looksLikeEmail(`${'a'.repeat(250)}@b.cn`)).toBe(false);
  });
});

describe('a bio', () => {
  test('is one line, cleaned as a contact is, or none when it shows nothing', () => {
    expect(checkBio('  Reviewer  of\tpapers \n and games ')).toEqual({
      bio: 'Reviewer of papers and games',
      problem: null,
    });
    expect(checkBio('a\u{200b}b')).toEqual({ bio: 'ab', problem: null });
    expect(checkBio(`a${ZERO_WIDTH_JOINER}b`)).toEqual({ bio: `a${ZERO_WIDTH_JOINER}b`, problem: null });
    expect(checkBio(ZHANG_SAN)).toEqual({ bio: ZHANG_SAN, problem: null });
    for (const none of [undefined, '', '   ', '\u{200b}', 7 as unknown as string]) {
      expect(checkBio(none), JSON.stringify(none)).toEqual({ bio: null, problem: null });
    }
  });

  test('has at most 80 characters as a reader counts them, and a long text is not looked at', () => {
    const longest = 'x'.repeat(MAX_BIO_LENGTH);
    expect(checkBio(longest)).toEqual({ bio: longest, problem: null });
    expect(checkBio(`${longest}x`)).toEqual({ bio: `${longest}x`, problem: 'bio_too_long' });
    expect(checkBio('\u{1f469}\u{200d}\u{1f4bb}'.repeat(MAX_BIO_LENGTH)).problem).toBeNull();
    expect(checkBio('x'.repeat(MAX_BIO_INPUT + 1))).toEqual({ bio: null, problem: 'bio_too_long' });
  });
});

describe('a handle', () => {
  test('is 12 hexadecimal digits in lower case', () => {
    expect(HANDLE.test('0123456789ab')).toBe(true);
    for (const wrong of ['', '0123456789', '0123456789abc', '0123456789AB', '0123456789ag', '../etc/passwd']) {
      expect(HANDLE.test(wrong), wrong).toBe(false);
    }
  });
});
