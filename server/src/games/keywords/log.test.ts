import { describe, expect, test } from 'vitest';
import type { GameContext } from '../../core/game';
import { seededRng } from '../../core/random';
import { keywordsGame } from './index';

// What the game tells the log and the record of a game (docs/architecture.md#game-records).

const gameId = 'g1';
// A zero-width space, which cleanClue takes out of a clue.
const INVISIBLE = String.fromCharCode(0x200b);

describe('the log of the team word guessing game', () => {
  const logged = (type: string, payload: unknown) => keywordsGame.logged?.(type, payload);
  const keys: Record<string, string> = { ann: 'key-ann', bob: 'key-bob', cat: 'key-cat', dan: 'key-dan' };
  const context = (): GameContext => ({
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
  });
  // Ann and Bob are the red PI and student, Cat and Dan the blue ones.
  const seated = (ctx: GameContext) => {
    let data = keywordsGame.create('en');
    for (const id of Object.keys(keys)) data = keywordsGame.join(data, ctx, id, false);
    for (const [id, team, role] of [
      ['ann', 'red', 'captain'],
      ['bob', 'red', 'guesser'],
      ['cat', 'blue', 'captain'],
      ['dan', 'blue', 'guesser'],
    ] as const) {
      const result = keywordsGame.handle(data, ctx, id, 'keywords:seat', { team, role });
      if (!result.ok) throw new Error(result.error);
      data = result.data;
    }
    return data;
  };

  test("keeps what each message carried, without the game's ID", () => {
    expect(logged('keywords:clue', { gameId, turn: 1, word: 'Hint', count: 2, targets: [4, 1] })).toEqual({
      data: { turn: 1, word: 'Hint', count: 2, targets: [4, 1] },
    });
    expect(logged('keywords:clue', { gameId, turn: 1, word: 'Hint', count: 'unlimited' })).toEqual({
      data: { turn: 1, word: 'Hint', count: 'unlimited' },
    });
    expect(logged('keywords:reveal', { gameId, turn: 3, card: 7 })).toEqual({ data: { turn: 3, card: 7 } });
    expect(logged('keywords:pass', { gameId, turn: 3 })).toEqual({ data: { turn: 3 } });
    expect(logged('keywords:extend', { gameId, turn: 3 })).toEqual({ data: { turn: 3 } });
    // A seat change says where a player is from then on, and a pause is the chair's alone.
    expect(logged('keywords:seat', { team: 'red', role: 'captain' })).toEqual({
      data: { team: 'red', role: 'captain' },
    });
    expect(logged('keywords:pause', { gameId })).toEqual({});
    expect(logged('keywords:resume', { gameId })).toEqual({});
  });

  test("keeps the clue's word as the record keeps it, without invisible characters", () => {
    const word = ['Gra', 'dient', ' descent'].join(INVISIBLE);
    expect(logged('keywords:clue', { gameId, turn: 1, word, count: 1 })).toEqual({
      data: { turn: 1, word: 'Gradient descent', count: 1 },
    });
  });

  test('keeps what a player said in the chat apart, as the chat shows it', () => {
    expect(logged('keywords:say', { gameId, text: '  The secret plan ' })).toEqual({ said: 'The secret plan' });
  });

  test('keeps nothing of a card chosen, nor of what it does not know', () => {
    expect(logged('keywords:select', { gameId, turn: 2, card: 4 })).toBeNull();
    expect(logged('keywords:select', { gameId, turn: 2, card: null })).toBeNull();
    expect(logged('keywords:nonsense', {})).toBeNull();
    expect(logged('keywords:reveal', { gameId, turn: 'one' })).toBeNull();
  });

  test('says how the game began, every color included, and whom it is waiting for', () => {
    const ctx = context();
    let data = seated(ctx);
    expect(keywordsGame.setup?.(data)).toBeNull();
    const words = Array.from({ length: 25 }, (_, index) => ({ word: `Word${index}` }));
    data = keywordsGame.start(data, { ...ctx, phase: 'playing' }, words, gameId);
    const game = data.game;
    if (!game) throw new Error('no game');
    expect(keywordsGame.setup?.(data)).toEqual({
      language: 'en',
      settings: game.settings,
      startingTeam: game.startingTeam,
      cards: game.cards.map(({ word, color }) => ({ word, color })),
    });
    // The PI of the group on turn while the clue is due, then its students.
    const pi = game.team === 'red' ? 'ann' : 'cat';
    const student = game.team === 'red' ? 'bob' : 'dan';
    expect(keywordsGame.due?.(data)).toEqual([pi]);
    const clued = keywordsGame.handle(data, { ...ctx, phase: 'playing' }, pi, 'keywords:clue', {
      gameId,
      turn: game.turn,
      word: 'Hint',
      count: 1,
    });
    if (!clued.ok) throw new Error(clued.error);
    expect(keywordsGame.due?.(clued.data)).toEqual([student]);
    expect(keywordsGame.rulesVersion).toBe(1);
  });

  test('counts what an AI player did: its clues, the cards they found, its best clue and Reviewer 2', () => {
    const ctx = context();
    const words = Array.from({ length: 25 }, (_, index) => ({ word: `Word${index}` }));
    let data = keywordsGame.start(seated(ctx), { ...ctx, phase: 'playing' }, words, gameId);
    const playing = { ...ctx, phase: 'playing' as const };
    const act = (id: string, type: string, payload: object) => {
      const result = keywordsGame.handle(data, playing, id, type, { gameId, turn: data.game?.turn, ...payload });
      if (!result.ok) throw new Error(result.error);
      data = result.data;
    };
    const cards = data.game?.cards ?? [];
    const red = (data.game?.team ?? 'red') === 'red';
    const [pi, student, otherPi, otherStudent] = red ? ['ann', 'bob', 'cat', 'dan'] : ['cat', 'dan', 'ann', 'bob'];
    const team = data.game?.team as 'red' | 'blue';
    const own = cards.flatMap((card, index) => (card.color === team ? [index] : []));
    const [neutral, otherNeutral] = cards.flatMap((card, index) => (card.color === 'neutral' ? [index] : []));
    const reviewer2 = cards.findIndex((card) => card.color === 'reviewer2');
    // A clue that finds two of the group's cards, then a card that is no group's.
    act(pi as string, 'keywords:clue', { word: 'Pair', count: 2 });
    act(student as string, 'keywords:reveal', { card: own[0] });
    act(student as string, 'keywords:reveal', { card: own[1] });
    act(student as string, 'keywords:reveal', { card: neutral });
    // The other group's turn, then a clue that finds one, and Reviewer 2.
    act(otherPi as string, 'keywords:clue', { word: 'Other', count: 1 });
    act(otherStudent as string, 'keywords:reveal', { card: otherNeutral });
    act(pi as string, 'keywords:clue', { word: 'Single', count: 1 });
    act(student as string, 'keywords:reveal', { card: own[2] });
    act(student as string, 'keywords:reveal', { card: reviewer2 });
    expect(keywordsGame.agentFeats?.(data, pi as string)).toEqual({
      clues: 2,
      found: 3,
      reviewer2: 0,
      best: { word: 'Pair', found: 2 },
    });
    expect(keywordsGame.agentFeats?.(data, student as string)).toEqual({
      clues: 0,
      found: 0,
      reviewer2: 1,
      best: null,
    });
  });

  test('says where each player is, and counts everyone who sat in a group as having played', () => {
    const ctx = context();
    const words = Array.from({ length: 25 }, (_, index) => ({ word: `Word${index}` }));
    let data = keywordsGame.start(seated(ctx), { ...ctx, phase: 'playing' }, words, gameId);
    const sit = (id: string, team: 'red' | 'blue' | null, role: 'captain' | 'guesser' | 'spectator') => {
      const result = keywordsGame.handle(data, ctx, id, 'keywords:seat', { team, role });
      if (!result.ok) throw new Error(result.error);
      data = result.data;
    };
    const where = (id: string) => keywordsGame.seated?.(data, id);
    expect(['ann', 'bob', 'cat', 'dan'].map(where)).toEqual([
      { team: 'red', role: 'captain' },
      { team: 'red', role: 'guesser' },
      { team: 'blue', role: 'captain' },
      { team: 'blue', role: 'guesser' },
    ]);
    // Whoever has no seat watches; so does Bob once he steps out, but he has played all the same.
    expect(where('eve')).toEqual({ team: null, role: 'spectator' });
    sit('bob', null, 'spectator');
    expect(where('bob')).toEqual({ team: null, role: 'spectator' });
    expect(keywordsGame.participants?.(data, ctx).sort()).toEqual(['key-ann', 'key-bob', 'key-cat', 'key-dan']);
  });
});
