import { describe, expect, test } from 'vitest';
import { cryptoRng, pick, randomId, seededRng, shuffle } from './random';

describe('random', () => {
  test('seeded generators repeat themselves and stay in range', () => {
    const a = seededRng(42);
    const b = seededRng(42);
    const draws = Array.from({ length: 1000 }, () => a.int(7));
    expect(Array.from({ length: 1000 }, () => b.int(7))).toEqual(draws);
    expect(draws.every((n) => Number.isInteger(n) && n >= 0 && n < 7)).toBe(true);
    expect(new Set(draws).size).toBe(7);
  });

  test('shuffle returns a permutation and leaves its input alone', () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    const shuffled = shuffle(items, seededRng(1));
    expect([...shuffled].sort((x, y) => x - y)).toEqual(items);
    expect(shuffled).not.toEqual(items);
    expect(items[0]).toBe(0);
  });

  test('pick and the crypto generator', () => {
    expect(['a', 'b', 'c']).toContain(pick(['a', 'b', 'c'], cryptoRng));
    expect(() => pick([], cryptoRng)).toThrow();
    for (let i = 0; i < 100; i += 1) expect(cryptoRng.int(3)).toBeLessThan(3);
  });

  test('random IDs are URL-safe and differ', () => {
    const ids = new Set(Array.from({ length: 100 }, () => randomId()));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });
});
