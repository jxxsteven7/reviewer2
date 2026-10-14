import type { ChatMessage } from '@reviewer2/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { clearMemory, writeStored } from '../../core/storage';
import { byTurn, markSeen, seenIn, unread } from './chat';

const message = (id: number, player: string, turn: number): ChatMessage => ({ id, player, turn, text: `m${id}` });
const messages = [message(1, 'a', 1), message(2, 'b', 1), message(3, 'a', 3), message(4, 'b', 3), message(5, 'b', 4)];

describe('the group chat', () => {
  afterEach(() => {
    clearMemory();
    vi.unstubAllGlobals();
  });

  test('groups messages by the turn in which they were written', () => {
    expect(byTurn(messages).map(({ turn, messages }) => [turn, messages.map(({ id }) => id)])).toEqual([
      [1, [1, 2]],
      [3, [3, 4]],
      [4, [5]],
    ]);
    expect(byTurn([])).toEqual([]);
  });

  test('puts what was written after the game apart, last, though it has the last turn', () => {
    const after = [
      ...messages,
      { ...message(6, 'a', 4), after: true as const },
      { ...message(7, 'b', 4), after: true as const },
    ];
    expect(
      byTurn(after).map(({ turn, after: late, messages: some }) => [turn, late ?? false, some.map(({ id }) => id)]),
    ).toEqual([
      [1, false, [1, 2]],
      [3, false, [3, 4]],
      [4, false, [5]],
      [4, true, [6, 7]],
    ]);
  });

  test("counts the others' messages after the last one seen", () => {
    expect(unread(messages, 0, 'a')).toBe(3);
    expect(unread(messages, 3, 'a')).toBe(2);
    expect(unread(messages, 5, 'a')).toBe(0);
    expect(unread(messages, 0, null)).toBe(5);
  });

  test('remembers the last message seen in each of the latest games', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(seenIn('game-1')).toBe(0);
    markSeen('game-1', 4);
    expect(seenIn('game-1')).toBe(4);
    expect(seenIn('game-2')).toBe(0);
    // Another game, such as one in a second tab, doesn't take the first one's place.
    markSeen('game-2', 1);
    expect(seenIn('game-1')).toBe(4);
    expect(seenIn('game-2')).toBe(1);
    markSeen('game-1', 6);
    expect(seenIn('game-1')).toBe(6);
    // Only the latest few games are kept.
    for (let game = 3; game <= 9; game += 1) markSeen(`game-${game}`, game);
    expect(seenIn('game-9')).toBe(9);
    expect(seenIn('game-1')).toBe(6);
    expect(seenIn('game-2')).toBe(0);
  });

  test('takes a stored value it does not understand as nothing seen', () => {
    vi.stubGlobal('localStorage', undefined);
    writeStored('r2.chatSeen', 'game-1:4');
    expect(seenIn('game-1')).toBe(0);
    writeStored('r2.chatSeen', '{"game-1":4}');
    expect(seenIn('game-1')).toBe(0);
    markSeen('game-1', 2);
    expect(seenIn('game-1')).toBe(2);
  });
});
