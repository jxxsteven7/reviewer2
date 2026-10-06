import type { ChatMessage } from '@reviewer2/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { clearMemory } from '../../core/storage';
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

  test("counts the others' messages after the last one seen", () => {
    expect(unread(messages, 0, 'a')).toBe(3);
    expect(unread(messages, 3, 'a')).toBe(2);
    expect(unread(messages, 5, 'a')).toBe(0);
    expect(unread(messages, 0, null)).toBe(5);
  });

  test('remembers the last message seen for the current game only', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(seenIn('game-1')).toBe(0);
    markSeen('game-1', 4);
    expect(seenIn('game-1')).toBe(4);
    expect(seenIn('game-2')).toBe(0);
    markSeen('game-2', 1);
    expect(seenIn('game-1')).toBe(0);
  });
});
