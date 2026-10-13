import { describe, expect, test } from 'vitest';
import type { GameContext } from '../../core/game';
import { seededRng } from '../../core/random';
import { keywordsGame } from './index';

// What the game tells the log of a game (docs/architecture.md#game-records).

const gameId = 'g1';
// A zero-width space, which cleanClue takes out of a clue.
const INVISIBLE = String.fromCharCode(0x200b);

describe('the log of the team word guessing game', () => {
  const logged = (type: string, payload: unknown) => keywordsGame.logged?.(type, payload);

  test("keeps what each message said, without the game's ID", () => {
    expect(logged('keywords:clue', { gameId, turn: 1, word: 'Hint', count: 2, targets: [4, 1] })).toEqual({
      data: { turn: 1, word: 'Hint', count: 2, targets: [4, 1] },
      minor: false,
    });
    expect(logged('keywords:clue', { gameId, turn: 1, word: 'Hint', count: 'unlimited' })).toEqual({
      data: { turn: 1, word: 'Hint', count: 'unlimited' },
      minor: false,
    });
    expect(logged('keywords:reveal', { gameId, turn: 3, card: 7 })).toEqual({
      data: { turn: 3, card: 7 },
      minor: false,
    });
    expect(logged('keywords:pass', { gameId, turn: 3 })).toEqual({ data: { turn: 3 }, minor: false });
    expect(logged('keywords:extend', { gameId, turn: 3 })).toEqual({ data: { turn: 3 }, minor: false });
  });

  test("keeps the clue's word as the record keeps it, without invisible characters", () => {
    const word = ['Gra', 'dient', ' descent'].join(INVISIBLE);
    expect(logged('keywords:clue', { gameId, turn: 1, word, count: 1 })).toEqual({
      data: { turn: 1, word: 'Gradient descent', count: 1 },
      minor: false,
    });
  });

  test('counts choosing a card as minor, and nothing else', () => {
    expect(logged('keywords:select', { gameId, turn: 2, card: null })).toEqual({
      data: { turn: 2, card: null },
      minor: true,
    });
    // A seat change says where a player is from then on, and a pause is the chair's alone.
    expect(logged('keywords:seat', { team: 'red', role: 'captain' })).toEqual({
      data: { team: 'red', role: 'captain' },
      minor: false,
    });
    expect(logged('keywords:pause', { gameId })).toEqual({ minor: false });
    expect(logged('keywords:resume', { gameId })).toEqual({ minor: false });
  });

  test('keeps nothing of the chat, and nothing of what it does not know', () => {
    expect(logged('keywords:say', { gameId, text: 'The secret plan' })).toBeNull();
    expect(logged('keywords:nonsense', {})).toBeNull();
    expect(logged('keywords:reveal', { gameId, turn: 'one' })).toBeNull();
  });

  test('says where each player is, and counts everyone who sat in a group as having played', () => {
    const keys: Record<string, string> = { ann: 'key-ann', bob: 'key-bob', cat: 'key-cat', dan: 'key-dan' };
    const ctx: GameContext = {
      phase: 'lobby',
      language: 'en',
      rng: seededRng(1),
      chairId: 'ann',
      now: () => 0,
      keyOf: (id) => keys[id] ?? id,
      nameOf: (id) => id,
      isOnline: () => true,
      agentOf: () => null,
      playerIds: () => Object.keys(keys),
    };
    let data = keywordsGame.create('en');
    for (const id of Object.keys(keys)) data = keywordsGame.join(data, ctx, id, false);
    const sit = (id: string, team: 'red' | 'blue' | null, role: 'captain' | 'guesser' | 'spectator') => {
      const result = keywordsGame.handle(data, ctx, id, 'keywords:seat', { team, role });
      if (!result.ok) throw new Error(result.error);
      data = result.data;
    };
    sit('ann', 'red', 'captain');
    sit('bob', 'red', 'guesser');
    sit('cat', 'blue', 'captain');
    sit('dan', 'blue', 'guesser');
    const words = Array.from({ length: 25 }, (_, index) => ({ word: `Word${index}` }));
    data = keywordsGame.start(data, { ...ctx, phase: 'playing' }, words, gameId);
    const seated = (id: string) => keywordsGame.seated?.(data, id);
    expect(['ann', 'bob', 'cat', 'dan'].map(seated)).toEqual([
      { team: 'red', role: 'captain' },
      { team: 'red', role: 'guesser' },
      { team: 'blue', role: 'captain' },
      { team: 'blue', role: 'guesser' },
    ]);
    // Whoever has no seat watches; so does Bob once he steps out, but he has played all the same.
    expect(seated('eve')).toEqual({ team: null, role: 'spectator' });
    sit('bob', null, 'spectator');
    expect(seated('bob')).toEqual({ team: null, role: 'spectator' });
    expect(keywordsGame.participants?.(data, ctx).sort()).toEqual(['key-ann', 'key-bob', 'key-cat', 'key-dan']);
  });
});
