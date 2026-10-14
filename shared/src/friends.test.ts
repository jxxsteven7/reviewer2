import { describe, expect, test } from 'vitest';
import { checkAlias, checkFriendNote, FRIEND_ALIAS_LENGTH, FRIEND_NOTE_LENGTH } from './friends';

// The line with a friend request, and the name an account gives a friend
// (docs/architecture.md#friends).

describe('the line with a friend request', () => {
  test('is one line, cleaned as a line of the chat, of at most 50 characters', () => {
    expect(checkFriendNote(' We met at\nthe workshop ')).toEqual({ note: 'We met at the workshop', problem: null });
    expect(checkFriendNote('x'.repeat(FRIEND_NOTE_LENGTH))).toEqual({ note: 'x'.repeat(50), problem: null });
    expect(checkFriendNote('x'.repeat(FRIEND_NOTE_LENGTH + 1)).problem).toBe('friend_note_too_long');
    expect(checkFriendNote('x'.repeat(1000)).problem).toBe('friend_note_too_long');
  });

  test('is none when it is left out or shows nothing, and keeps what it says', () => {
    expect(checkFriendNote(undefined)).toEqual({ note: null, problem: null });
    expect(checkFriendNote(' \u200b ')).toEqual({ note: null, problem: null });
    expect(checkFriendNote('a\u200bb').note).toBe('ab');
  });
});

describe('the name an account gives a friend', () => {
  test('is cleaned as a nickname is, with up to 20 characters', () => {
    expect(checkAlias('  Bobby   the  Chair ')).toEqual({ alias: 'Bobby the Chair', problem: null });
    expect(checkAlias('\uff22\uff4f\uff42')).toEqual({ alias: 'Bob', problem: null });
    expect(checkAlias('x'.repeat(FRIEND_ALIAS_LENGTH)).problem).toBeNull();
    expect(checkAlias('x'.repeat(FRIEND_ALIAS_LENGTH + 1)).problem).toBe('friend_alias_too_long');
  });

  test('is none when empty, and refused with something in it that a reader cannot see', () => {
    expect(checkAlias('   ')).toEqual({ alias: null, problem: null });
    expect(checkAlias('Bo\u200bb').problem).toBe('friend_alias_invalid');
    expect(checkAlias(42 as unknown as string).problem).toBe('friend_alias_invalid');
  });
});
