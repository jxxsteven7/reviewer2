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

  // A shuffle that is off by one never leaves the last item in its place, and reaches only some
  // of the orders.
  test('shuffle reaches every order, with both generators', () => {
    const seeded = new Set<string>();
    const crypto = new Set<string>();
    for (let seed = 0; seed < 200; seed += 1) {
      seeded.add(shuffle(['a', 'b', 'c'], seededRng(seed)).join(''));
      crypto.add(shuffle(['a', 'b', 'c'], cryptoRng).join(''));
    }
    const orders = ['abc', 'acb', 'bac', 'bca', 'cab', 'cba'];
    expect([...seeded].sort()).toEqual(orders);
    expect([...crypto].sort()).toEqual(orders);
  });

  test('both generators refuse a range that is empty or not whole', () => {
    for (const below of [0, -5, 2.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 48]) {
      expect(() => seededRng(1).int(below), `seeded ${below}`).toThrow();
      expect(() => cryptoRng.int(below), `crypto ${below}`).toThrow();
    }
    expect(seededRng(1).int(1)).toBe(0);
    expect(cryptoRng.int(1)).toBe(0);
    expect(seededRng(1).int(2 ** 48 - 1)).toBeLessThan(2 ** 48 - 1);
    expect(cryptoRng.int(2 ** 48 - 1)).toBeLessThan(2 ** 48 - 1);
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
