// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { setLanguage } from './i18n';
import { aliasOf, knowAliases, nameOf, usernameAfter } from './names';

beforeEach(() => {
  setLanguage('en', { remember: false });
  knowAliases([{ handle: 'b0b000000000', alias: 'Bobby' }, { handle: 'ca7000000000' }]);
});

afterEach(() => knowAliases([]));

describe('nameOf', () => {
  test("calls a friend by the viewer's name for them, and anyone else by their username", () => {
    expect(nameOf({ name: 'Bob', handle: 'b0b000000000' })).toBe('Bobby');
    // A friend without a name of the viewer's, and a stranger.
    expect(nameOf({ name: 'Cat', handle: 'ca7000000000' })).toBe('Cat');
    expect(nameOf({ name: 'Dan', handle: 'da9000000000' })).toBe('Dan');
    // Someone the page knows by no account, as a player who left.
    expect(nameOf({ name: 'Eve' })).toBe('Eve');
  });

  test('calls a guest, an AI player and a deleted account as ever, whatever the viewer named', () => {
    expect(nameOf({ name: 'Guest 3', guest: 3 })).toBe('Guest 3');
    expect(nameOf({ name: 'reviewer1', agent: 'reviewer1' })).toBe('Reviewer 1');
    expect(nameOf({ deleted: true })).toBe('Deleted player');
  });

  test('keeps to the username where others see the page too, as on a big screen', () => {
    expect(nameOf({ name: 'Bob', handle: 'b0b000000000' }, false)).toBe('Bob');
  });

  test('follows the friends list as it changes, and a guest has no names for anyone', () => {
    knowAliases([{ handle: 'b0b000000000', alias: 'Prof. B' }]);
    expect(nameOf({ name: 'Bob', handle: 'b0b000000000' })).toBe('Prof. B');
    knowAliases([]);
    expect(nameOf({ name: 'Bob', handle: 'b0b000000000' })).toBe('Bob');
    expect(aliasOf('b0b000000000')).toBeNull();
    expect(aliasOf(undefined)).toBeNull();
  });
});

describe('usernameAfter', () => {
  test("gives the username to follow the viewer's name for a friend, and nothing where the name is the username", () => {
    expect(usernameAfter({ name: 'Bobby', username: 'Bob' })).toBe('Bob');
    expect(usernameAfter({ name: 'Cat', username: 'Cat' })).toBeNull();
    expect(usernameAfter({ name: 'Guest 3' })).toBeNull();
  });
});
